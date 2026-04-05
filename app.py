import os, datetime, pytz, json, pypdf
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from groq import Groq
from tavily import TavilyClient
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['JWT_SECRET_KEY'] = os.getenv("SECRET_KEY", "super-secret")
db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
jwt = JWTManager(app)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    image_limit = db.Column(db.Integer, default=1000)
    history = db.Column(db.Text, default="[]") 

with app.app_context():
    db.create_all()

@app.route('/')
def index(): return render_template('index.html')

@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    hashed_pw = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    if User.query.filter_by(email=data['email']).first():
        return jsonify({"msg": "User already exists"}), 400
    new_user = User(email=data['email'], password=hashed_pw)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"msg": "User Created"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(email=data['email']).first()
    if user and bcrypt.check_password_hash(user.password, data['password']):
        token = create_access_token(identity=user.email, expires_delta=datetime.timedelta(days=7))
        # History JSON parse karke bhej rahe hain
        return jsonify({"token": token, "history": json.loads(user.history), "limit": user.image_limit})
    return jsonify({"msg": "Invalid Credentials"}), 401

@app.route('/upload', methods=['POST'])
@jwt_required()
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "Koi file nahi mili"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "File select nahi ki gayi"}), 400
    
    if file and file.filename.endswith('.pdf'):
        try:
            pdf_reader = pypdf.PdfReader(file)
            extracted_text = ""
            for page in pdf_reader.pages:
                extracted_text += page.extract_text() + "\n"
            return jsonify({"msg": "PDF Read!", "text": extracted_text[:10000]})
        except Exception as e: return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Only PDF supported."}), 400

@app.route('/delete_chat/<chat_id>', methods=['DELETE'])
@jwt_required()
def delete_chat(chat_id):
    user_email = get_jwt_identity()
    user = User.query.filter_by(email=user_email).first()
    
    if user and user.history:
        all_chats = json.loads(user.history)
        # Jis chat ka ID match karega, use hata denge
        updated_chats = [c for c in all_chats if c["id"] != str(chat_id)]
        user.history = json.dumps(updated_chats)
        db.session.commit()
        return jsonify({"msg": "Chat deleted successfully"})
        
    return jsonify({"error": "Failed to delete"}), 400

@app.route('/chat', methods=['POST'])
@jwt_required()
def chat():
    user_email = get_jwt_identity()
    user = User.query.filter_by(email=user_email).first()
    
    user_msg = request.json.get('msg', '')
    chat_id = request.json.get('chat_id') # Naya ID system
    
    IST = pytz.timezone('Asia/Kolkata')
    current_time = datetime.datetime.now(IST).strftime('%Y-%m-%d %I:%M:%S %p')

    # Load all chats
    all_chats = json.loads(user.history) if user.history else []
    
    # Find active chat session or create new
    chat_session = next((c for c in all_chats if c["id"] == str(chat_id)), None)
    if not chat_session:
        title = user_msg[:20] + "..." if len(user_msg) > 0 else "New Chat"
        chat_session = {"id": str(chat_id), "title": title, "messages": []}
        all_chats.append(chat_session)

    # Image Logic
    if any(word in user_msg.lower() for word in ["banao", "generate image"]):
        if user.image_limit > 0:
            user.image_limit -= 1
            img_url = f"https://pollinations.ai/p/{user_msg.replace(' ', '%20')}?width=1024&height=1024&nologo=true"
            chat_session["messages"].append({"role": "user", "content": user_msg})
            chat_session["messages"].append({"role": "assistant", "type": "image", "content": img_url})
            user.history = json.dumps(all_chats)
            db.session.commit()
            return jsonify({"type": "image", "content": img_url, "limit": user.image_limit, "chat_id": chat_session["id"], "title": chat_session["title"]})
        return jsonify({"type": "text", "content": "Limit Over!"})

    # Web Search Logic
    search_context = ""
    if any(word in user_msg.lower() for word in ["weather", "news", "today"]):
        try:
            search_res = tavily.search(query=user_msg)
            search_context = f"\nWeb Search Info: {search_res['results'][:1]}"
        except: pass

    # Context Memory Logic (Last 6 messages)
    chat_session["messages"].append({"role": "user", "content": user_msg})
    
    llm_context = []
    # Yahan bot ko pichle 6 messages sikhaye jaa rahe hain
    for m in chat_session["messages"][-6:]: 
        if m.get("type") != "image":
            llm_context.append({"role": m["role"], "content": m["content"]})

    response = client.chat.completions.create(
        messages=[{"role": "system", "content": f"You are ChatGPT. Time: {current_time}. {search_context}"}] + llm_context,
        model="llama-3.3-70b-versatile"
    )
    bot_reply = response.choices[0].message.content
    
    chat_session["messages"].append({"role": "assistant", "type": "text", "content": bot_reply})
    user.history = json.dumps(all_chats)
    db.session.commit()
    
    return jsonify({"type": "text", "content": bot_reply, "chat_id": chat_session["id"], "title": chat_session["title"]})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)