/* Multi-contact frontend with macOS-like horizontal layout
   - Left: contacts list
   - Right: messages + composer
   - Supports selecting a contact and per-contact message history
*/

const contactsEl = document.getElementById('contacts');
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const activeNameEl = document.getElementById('active-name');
const activeStatusEl = document.getElementById('active-status');
const activeAvatarEl = document.getElementById('active-avatar');

let isProcessing = false;

const contacts = [
	{id: '1', name: '刘煊溢', status: '我行我素！', avatar: '刘', prompt: '', messages: [
		{role: 'roommate', content: '我操，不是吧，又吃麦当劳？有钱哥。'}
	]},
	/*{id: '2', name: 'Bob', status: '离线', avatar: 'B', prompt: '你是 Bob，偏好详细技术性回复。', messages: [
		{role: 'assistant', content: 'Bob 在休息，稍后回复。'}
	]},
	{id: '3', name: 'Carol', status: '在线', avatar: 'C', prompt: '你是 Carol，语气轻松，常用比喻和例子。', messages: [
		{role: 'assistant', content: '你好，我是 Carol，有什么可以帮忙的吗？'}
	]}*/
];

let activeContactId = contacts[0].id;

function init(){
	renderContacts();
	selectContact(activeContactId);

	userInput.addEventListener('input', () => {
		userInput.style.height = 'auto';
		userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
	});

	userInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	sendButton.addEventListener('click', sendMessage);
}

function renderContacts(){
	contactsEl.innerHTML = '';
	for(const c of contacts){
		const item = document.createElement('div');
		item.className = 'contact-item';
		item.dataset.id = c.id;

		const av = document.createElement('div');
		av.className = 'avatar';
		av.textContent = c.avatar;

		const meta = document.createElement('div');
		meta.className = 'contact-meta';
		meta.innerHTML = `<div class="name">${escapeHtml(c.name)}</div><div class="status">${escapeHtml(c.status)}</div>`;

		item.appendChild(av);
		item.appendChild(meta);

		item.addEventListener('click', () => selectContact(c.id));

		contactsEl.appendChild(item);
	}
	highlightActiveContact();
}

function highlightActiveContact(){
	const items = contactsEl.querySelectorAll('.contact-item');
	items.forEach(it => {
		it.classList.toggle('active', it.dataset.id === activeContactId);
	});
}

async function selectContact(id){
	const contact = contacts.find(c => c.id === id);
	if(!contact) return;
	activeContactId = id;
	// try to load markdown prompt file for this contact
	await loadPromptForContact(contact);
	activeNameEl.textContent = contact.name;
	activeStatusEl.textContent = contact.status;
	if(activeAvatarEl){ activeAvatarEl.textContent = contact.avatar; }
	renderChatForActiveContact();
	highlightActiveContact();
}

async function loadPromptForContact(contact){
	// attempt to fetch ./prompts/{id}.md in public/; fallback to contact.prompt if missing
	try{
		const resp = await fetch(`./prompts/${contact.id}.md`);
		if(!resp.ok) return; // leave existing prompt
		const text = await resp.text();
		// strip leading markdown title if present, but keep full text as prompt
		contact.prompt = text.trim();
	}catch(e){
		// ignore network errors and keep existing contact.prompt
		console.debug('No prompt file for contact', contact.id, e);
	}
}

function renderChatForActiveContact(){
	messagesEl.innerHTML = '';
	const contact = contacts.find(c => c.id === activeContactId);
	for(const m of contact.messages){
		appendBubble(m.role, m.content);
	}
}

function appendBubble(role, content, opts={}){
	const row = document.createElement('div');
	row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');

	const bubble = document.createElement('div');
	bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
	bubble.innerHTML = escapeHtml(content);

	row.appendChild(bubble);

	if(opts.meta){
		const meta = document.createElement('div');
		meta.className = 'meta';
		meta.textContent = opts.meta;
		row.appendChild(meta);
	}

	messagesEl.appendChild(row);
	scrollToBottom();
	return bubble;
}

function scrollToBottom(){
	requestAnimationFrame(()=>{
		messagesEl.scrollTop = messagesEl.scrollHeight;
	});
}

async function sendMessage(){
	const text = userInput.value.trim();
	if(!text || isProcessing) return;

	const contact = contacts.find(c => c.id === activeContactId);
	if(!contact) return;

	// add user bubble locally
	appendBubble('user', text);
	contact.messages.push({role:'user', content:text});

	// clear input
	userInput.value = '';
	userInput.style.height = 'auto';

	isProcessing = true;
	sendButton.disabled = true;

	const assistantBubble = appendBubble('assistant', '');

	try{
		// prepend system prompt for this contact (if provided)
		const messagesToSend = [];
		if(contact.prompt){ messagesToSend.push({role: 'system', content: contact.prompt}); }
		// send the conversation history for context
		messagesToSend.push(...contact.messages);

		const resp = await fetch('/api/chat', {
			method: 'POST',
			headers: {'Content-Type':'application/json'},
			body: JSON.stringify({messages: messagesToSend}),
		});

		if(!resp.ok){
			throw new Error('Network error');
		}

		const reader = resp.body.getReader();
		const dec = new TextDecoder();
		let assistantText = '';

		while(true){
			const {done, value} = await reader.read();
			if(done) break;
			const chunk = dec.decode(value, {stream:true});
			const parts = chunk.split('\n').filter(Boolean);
			for(const p of parts){
				try{
					const j = JSON.parse(p);
					if(j.response){ assistantText += j.response; }
				}catch(e){
					assistantText += p;
				}
			}
			assistantBubble.innerHTML = escapeHtml(assistantText);
			scrollToBottom();
		}

		contact.messages.push({role:'assistant', content: assistantText});
	}catch(err){
		console.error(err);
		assistantBubble.innerHTML = '请求失败，请稍后重试。';
	}finally{
		isProcessing = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

function escapeHtml(str){
	if(!str) return '';
	return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// kick off
init();
