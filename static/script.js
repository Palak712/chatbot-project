let currentChatId = Date.now().toString();
let allChats = [];
window.pdfContext = "";

window.onload = () => {
    const toggleBtn = document.getElementById('togglePassword');
    if(toggleBtn) {
        toggleBtn.addEventListener('click', function () {
            const passwordField = document.getElementById('password');
            const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordField.setAttribute('type', type);
            this.textContent = type === 'password' ? 'Show' : 'Hide';
        });
    }
};

async function signup() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if(!email || !password) { alert("Please enter both email and password"); return; }
    try {
        const res = await fetch('/signup', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
        });
        const data = await res.json();
        alert(data.msg); 
    } catch (error) { alert("Server error!"); }
}

async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
        });
        const data = await res.json();
        
        if(data.token) {
            localStorage.setItem('token', data.token);
            document.getElementById('auth-container').style.display = 'none';
            document.getElementById('chat-container').style.display = 'flex';
            document.getElementById('limit-count').innerText = data.limit;
            
            // Load Chat History
            allChats = data.history || [];
            if(allChats.length > 0) {
                loadChat(allChats[allChats.length - 1].id); // Load most recent chat
            } else {
                createNewChat();
            }
        } else {
            alert(data.msg || "Login failed!");
        }
    } catch (error) { alert("Connection error!"); }
}

function logout() {
    localStorage.removeItem('token');
    location.reload();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('mobile-active');
}

// Sidebar ke bahar click karne par sidebar band ho jaye (Mobile only)
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menu-toggle');
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(e.target) && e.target !== menuBtn) {
            sidebar.classList.remove('mobile-active');
        }
    }
});

// LoadChat hone par bhi sidebar band ho jaye
const originalLoadChat = loadChat;
loadChat = function(id) {
    originalLoadChat(id);
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('mobile-active');
    }
};

// --- NEW CHAT & HISTORY LOGIC ---
// 1. Updated renderChatList (Isme Delete button add kiya hai)
function renderChatList() {
    const list = document.getElementById('chat-list');
    list.innerHTML = '';
    
    [...allChats].reverse().forEach(chat => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        
        // Chat ka title
        const titleSpan = document.createElement('span');
        titleSpan.innerText = chat.title;
        titleSpan.onclick = () => loadChat(chat.id);
        titleSpan.style.flex = "1";
        titleSpan.style.overflow = "hidden";
        titleSpan.style.textOverflow = "ellipsis";
        titleSpan.style.whiteSpace = "nowrap";
        
        // Delete Button (Trash icon)
        const deleteBtn = document.createElement('span');
        deleteBtn.innerText = "🗑️";
        deleteBtn.className = "delete-btn";
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // Isse chat load nahi hogi, seedha delete hogi
            deleteChat(chat.id);
        };
        
        itemDiv.appendChild(titleSpan);
        itemDiv.appendChild(deleteBtn);
        list.appendChild(itemDiv);
    });
}

// 2. New Delete Chat Function
async function deleteChat(id) {
    if(!confirm("Are you sure? Ye chat hamesha ke liye delete ho jayegi.")) return;
    
    try {
        const res = await fetch(`/delete_chat/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if(res.ok) {
            // Memory se chat hatao
            allChats = allChats.filter(c => c.id !== id);
            
            // Agar delete ki hui chat wahi thi jo khuli hai, toh nayi chat khol do
            if(currentChatId === id) {
                createNewChat(); 
            } else {
                renderChatList(); // Bas list update kar do
            }
        } else {
            alert("Delete karne mein problem aayi.");
        }
    } catch (error) {
        alert("Server connection error!");
    }
}

function createNewChat() {
    currentChatId = Date.now().toString();
    document.getElementById('messages').innerHTML = '';
    window.pdfContext = "";
    renderChatList();
}

function loadChat(id) {
    currentChatId = id;
    window.pdfContext = "";
    document.getElementById('messages').innerHTML = '';
    const chat = allChats.find(c => c.id === id);
    if(chat && chat.messages) {
        chat.messages.forEach(item => {
            if(item.type === 'image') appendImage(item.content);
            // role "assistant" ko "Bot" me display karein
            else appendMessage(item.role === 'user' ? 'User' : 'Bot', item.content); 
        });
    }
    renderChatList();
}

// --- FILE UPLOAD ---
document.getElementById('fileUpload').addEventListener('change', async function() {
    const file = this.files[0];
    if(!file) return;

    appendMessage('User', `📁 Uploading: ${file.name}...`);
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: formData
        });
        const data = await res.json();
        
        if(data.text) {
            window.pdfContext = data.text; 
            appendMessage('Bot', `✅ Main PDF padh liya hai! Sawal puchiye.`);
        } else { appendMessage('Bot', "❌ " + (data.error || "Upload failed.")); }
    } catch (error) { appendMessage('Bot', "❌ Upload error!"); }
});

// --- SEND MESSAGE ---
async function sendMessage() {
    const userInput = document.getElementById('userInput');
    const msg = userInput.value;
    if(!msg) return;

    appendMessage('User', msg);
    userInput.value = '';

    try {
        let finalMsg = msg;
        if(window.pdfContext !== "") {
            finalMsg = `[Context from PDF:\n${window.pdfContext}]\n\nQuestion: ${msg}`;
            window.pdfContext = ""; 
        }

        const res = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            // Added chat_id here
            body: JSON.stringify({ msg: finalMsg, chat_id: currentChatId }) 
        });
        const data = await res.json();

        // Update local memory
        if (!allChats.find(c => c.id === data.chat_id)) {
            allChats.push({id: data.chat_id, title: data.title, messages: []});
        }
        const chat = allChats.find(c => c.id === data.chat_id);
        chat.messages.push({role: 'user', content: msg});
        chat.messages.push({role: 'assistant', type: data.type, content: data.content});
        renderChatList(); // Refresh sidebar

        if(data.type === 'image') {
            appendImage(data.content);
            document.getElementById('limit-count').innerText = data.limit;
        } else {
            appendMessage('Bot', data.content);
        }
    } catch (error) { appendMessage('Bot', "Error: Server connection failed."); }
}

function appendMessage(sender, text) {
    const messagesDiv = document.getElementById('messages');
    const div = document.createElement('div');
    const cleanText = text || "Sorry, reply nahi mil paya."; 
    div.classList.add(sender.toLowerCase()); 
    div.innerHTML = `<b>${sender}:</b> ${cleanText}`; 
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendImage(url) {
    const messagesDiv = document.getElementById('messages');
    const img = document.createElement('img');
    img.src = url;
    img.style.width = '300px';
    img.style.borderRadius = '10px';
    img.style.marginTop = '10px';
    messagesDiv.appendChild(img);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('userInput').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') 
sendMessage();
});