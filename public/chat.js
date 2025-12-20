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
	{ id: 'group', name: '群聊', status: '三人组', avatar: '群', prompt: '', participants: ['1','2','3'], messages: [] },
	{id: '1', name: '榆木华', status: '企鹅罐头', avatar: '华', prompt: '', messages: [
		{role: '', content: '我是榆木华'}
	]},
	{id: '2', name: 'Snaur', status: '症', avatar: '卵', prompt: '', messages: [
		{role: '', content: '我是Snaur'}
	]},
	{id: '3', name: 'FFFanwen', status: '已读不回', avatar: '蚊', prompt: '', messages: [
		{role: '', content: '我是FFFanwen'}
	]}
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
		// if this is the group contact, load individual prompts for participants
		if(contact.id === 'group'){
			for(const pid of contact.participants || []){
				const p = contacts.find(c=>c.id===pid);
				if(!p) continue;
				try{
					const r = await fetch(`./prompts/${p.id}.md`);
					if(r.ok){ p.prompt = (await r.text()).trim(); }
				}catch(e){ console.debug('no prompt', p.id, e); }
			}
			return;
		}
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

function parseTalkativenessFromPrompt(text){
	if(!text) return 0.5;
	const m = text.match(/活跃度\s*\(talkativeness\)\s*：\s*([0-9.]+)/);
	if(m) return parseFloat(m[1]);
	const m2 = text.match(/talkativeness\)[:：]\s*([0-9.]+)/i);
	if(m2) return parseFloat(m2[1]);
	return 0.5;
}

function renderChatForActiveContact(){
	messagesEl.innerHTML = '';
	const contact = contacts.find(c => c.id === activeContactId);
	for(const m of contact.messages){
		if(m.role === 'user'){
			appendBubble('user', m.content);
		}else if(m.role && m.role !== 'assistant'){
			appendBubble('assistant', m.content, {meta: m.role});
		}else{
			appendBubble('assistant', m.content);
		}
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
		// prepare messagesToSend
		const messagesToSend = [];
		if(contact.id === 'group'){
			// build a combined system prompt that instructs the assistant to roleplay a 3-person group chat
			const parts = [];
			let totalActivity = 0;
			for(const pid of contact.participants || []){
				const p = contacts.find(c=>c.id===pid);
				if(!p) continue;
				parts.push(`Name: ${p.name}\nPrompt:\n${p.prompt || ''}`);
				totalActivity += parseTalkativenessFromPrompt(p.prompt);
			}
			const activityList = (contact.participants || []).map(pid=>{
				const p = contacts.find(c=>c.id===pid);
				return p ? `${p.name}:${parseTalkativenessFromPrompt(p.prompt)}` : '';
			}).filter(Boolean).join(', ');
			const system = `You are to simulate a short realistic group chat among the following participants. ` +
				`Each participant should speak with frequency roughly proportional to their "talkativeness" values. ` +
				`Participants definitions:\n${parts.join('\n\n')}\n\n` +
				`Talkativeness values: ${activityList}. ` +
				`When responding, output one or more lines. Each line must begin with the speaker's name followed by a colon and their utterance, e.g. \"榆木华: 我来说一句\". ` +
				`Choose 1-3 speakers for this response probabilistically; do not include narration. Keep each utterance concise and in-character. `;
			messagesToSend.push({role:'system', content: system});
			// include recent group messages for context
			const groupHistory = contact.messages.slice(-20).map(m=>({role: m.role || 'assistant', content: m.content}));
			messagesToSend.push(...groupHistory);
		}else{
			if(contact.prompt){ messagesToSend.push({role: 'system', content: contact.prompt}); }
			// send the conversation history for context
			messagesToSend.push(...contact.messages);
		}

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

			if(contact.id === 'group'){
				// remove the single assistant streaming bubble to replace with per-speaker bubbles
				try{ assistantBubble.remove(); }catch(e){}
			}

				// if group mode, parse assistantText into per-speaker lines
			if(contact.id === 'group'){
				const lines = assistantText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
				for(const ln of lines){
					const m = ln.match(/^([^:：]+)[:：]\s*(.+)$/);
					if(m){
						const name = m[1].trim();
						const content = m[2].trim();
						contact.messages.push({role: name, content});
						appendBubble('assistant', content, {meta: name});
					}else{
						contact.messages.push({role:'assistant', content: ln});
						appendBubble('assistant', ln);
					}
				}
			}else{
				contact.messages.push({role:'assistant', content: assistantText});
			}
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
