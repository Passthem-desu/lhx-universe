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
let inputLines = [];
// Configuration: adjust these to control reply timing and grouping behavior
const GROUP_REPLY_MIN_DELAY = 600;   // ms between sequential replies (min)
const GROUP_REPLY_MAX_DELAY = 1400;  // ms between sequential replies (max)
const GROUP_SCHEDULE_MIN_INTERVAL = 5000; // ms, auto-instruction scheduler min
const GROUP_SCHEDULE_MAX_INTERVAL = 25000; // ms, auto-instruction scheduler max
const GROUP_GROUP_THRESHOLD_MS = 60000; // ms, messages within this window are grouped

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

async function init(){
	// assign random default prompts to persona contacts before rendering
	await loadAllPromptsAndAssignRandom();
	// load external input lines for automated messages and start auto chat
	await loadInputLines();
	startAutoChat();
	renderContacts();
	await selectContact(activeContactId);

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
	// if contact already has a prompt, don't overwrite it (we may have assigned defaults)
	if(contact.id !== 'group' && contact.prompt) return;
	try{
		// if this is the group contact, load individual prompts for participants
		if(contact.id === 'group'){
			for(const pid of contact.participants || []){
				const p = contacts.find(c=>c.id===pid);
				if(!p) continue;
				if(p.prompt) continue;
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

function parseReplyRateFromPrompt(text){
	if(!text) return 0.5;
	const m = text.match(/"?reply_rate"?\s*[:：]\s*([0-9.]+)/i);
	if(m) return parseFloat(m[1]);
	return 0.5;
}

async function loadInputLines(){
	try{
		const resp = await fetch('./input.txt');
		if(!resp.ok) return;
		const txt = await resp.text();
		inputLines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
	}catch(e){
		console.debug('failed to load input.txt', e);
		inputLines = [];
	}
}

function pickRandomSender(contact){
	const parts = (contact.participants || []).map(pid=>contacts.find(c=>c.id===pid)).filter(Boolean);
	if(parts.length === 0) return null;
	const weights = parts.map(p => Math.max(0.01, parseTalkativenessFromPrompt(p.prompt) || 0.01));
	const sum = weights.reduce((a,b)=>a+b,0);
	const r = Math.random() * sum;
	let acc = 0;
	for(let i=0;i<parts.length;i++){
		acc += weights[i];
		if(r <= acc) return parts[i].id;
	}
	return parts[parts.length-1].id;
}

function simulateIncomingMessage(contact, senderId, text){
	const p = contacts.find(c=>c.id === senderId);
	const name = p ? p.name : '匿名';
	// append as a named message from participant
	contact.messages.push({role: name, content: text, ts: Date.now()});
	appendBubble('assistant', text, {meta: name, ts: Date.now(), target: contact.id});

	// decide whether the group will reply; compute average reply rate
	const parts = (contact.participants || []).map(pid=>contacts.find(c=>c.id===pid)).filter(Boolean);
	const avgReply = parts.map(pp=>parseReplyRateFromPrompt(pp.prompt)).reduce((a,b)=>a+b,0)/Math.max(1, parts.length);
	const willReply = Math.random() < Math.min(0.9, avgReply + 0.1 * (Math.random()-0.5));
	if(willReply){
		// random delay before group reply (0.5s - 4s)
		const delay = 500 + Math.floor(Math.random()*3500);
		setTimeout(()=>{
			triggerGroupResponse(contact);
		}, delay);
	}
}

// New: send instruction to model and ask personas to randomly reply according to reply_rate
async function triggerGroupResponseWithInstruction(contact, instructionText){
	if(!contact || contact.id !== 'group') return;
	if(contact._isResponding) return; // avoid concurrent group responses
	contact._isResponding = true;
	const parts = [];
	for(const pid of contact.participants || []){
		const p = contacts.find(c=>c.id===pid);
		if(!p) continue;
		const replyRate = parseReplyRateFromPrompt(p.prompt);
		const talk = parseTalkativenessFromPrompt(p.prompt);
		parts.push(`Name: ${p.name}\nReplyRate: ${replyRate}\nTalkativeness: ${talk}\nPrompt:\n${p.prompt || ''}`);
	}

	const system = `You are simulating a short group chat among the following participants. ` +
		`Each participant has a ReplyRate (probability of replying when given an instruction) and a Talkativeness value. ` +
		`When given an instruction, decide for each participant whether they reply probabilistically according to their ReplyRate. ` +
		`If a participant replies, generate one concise, in-character utterance for them based on their Prompt. ` +
		`Output only lines in the format: Name: <utterance>. Do not output extra explanation.` +
		`\n\nParticipants:\n${parts.join('\n\n')}\n\nInstruction: ${instructionText}`;

	const messagesToSend = [{role:'system', content: system}];
	// include recent history for context
	const groupHistory = contact.messages.slice(-20).map(m=>({role: m.role || 'assistant', content: m.content}));
	messagesToSend.push(...groupHistory);

	try{
		const resp = await fetch('/api/chat', {
			method: 'POST', headers: {'Content-Type':'application/json'},
			body: JSON.stringify({messages: messagesToSend}),
		});
		if(!resp.ok) return;
		const reader = resp.body.getReader();
		const dec = new TextDecoder();
		let assistantText = '';
		while(true){
			const {done, value} = await reader.read();
			if(done) break;
			const chunk = dec.decode(value, {stream:true});
			const parts = chunk.split('\n').filter(Boolean);
			for(const p of parts){
				try{ const j = JSON.parse(p); if(j.response) assistantText += j.response; }
				catch(e){ assistantText += p; }
			}
		}
		const lines = assistantText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
		const replies = [];
		for(const ln of lines){
			const m = ln.match(/^([^:：]+)[:：]\s*(.+)$/);
			if(m){
				const name = m[1].trim(); const content = m[2].trim();
				replies.push({name, content});
			}
		}
		// display replies sequentially in random order
		if(replies.length > 0){
			displaySequentialReplies(contact, replies);
		} else {
			contact._isResponding = false;
		}
	}catch(e){ console.error('group instruction response error', e); }
}

function displaySequentialReplies(contact, replies){
	// shuffle replies to create a random order
	for(let i = replies.length - 1; i > 0; i--){
		const j = Math.floor(Math.random() * (i + 1));
		[replies[i], replies[j]] = [replies[j], replies[i]];
	}
	// schedule each reply sequentially with a small random delay
	let cumulative = 0;
	replies.forEach((r, idx) => {
		const d = GROUP_REPLY_MIN_DELAY + Math.floor(Math.random() * (GROUP_REPLY_MAX_DELAY - GROUP_REPLY_MIN_DELAY));
		cumulative += d;
		setTimeout(()=>{
			contact.messages.push({role: r.name, content: r.content, ts: Date.now()});
			appendBubble('assistant', r.content, {meta: r.name, ts: Date.now(), target: contact.id});
			// if last, clear responding flag
			if(idx === replies.length - 1){
				contact._isResponding = false;
			}
		}, cumulative);
	});
}

async function triggerGroupResponse(contact){
	if(!contact || contact.id !== 'group') return;
	const messagesToSend = [];
	// rebuild system prompt as in sendMessage
	const parts = [];
	for(const pid of contact.participants || []){
		const p = contacts.find(c=>c.id===pid);
		if(!p) continue;
		parts.push(`Name: ${p.name}\nPrompt:\n${p.prompt || ''}`);
	}
	const activityList = (contact.participants || []).map(pid=>{
		const p = contacts.find(c=>c.id===pid);
		return p ? `${p.name}:${parseTalkativenessFromPrompt(p.prompt)}` : '';
	}).filter(Boolean).join(', ');
	const system = `You are to simulate a short realistic group chat among the following participants. ` +
		`Each participant should speak with frequency roughly proportional to their \"talkativeness\" values. ` +
		`Participants definitions:\n${parts.join('\n\n')}\n\n` +
		`Talkativeness values: ${activityList}. ` +
		`When responding, output one or more lines. Each line must begin with the speaker's name followed by a colon and their utterance.`;
	messagesToSend.push({role:'system', content: system});
	const groupHistory = contact.messages.slice(-20).map(m=>({role: m.role || 'assistant', content: m.content}));
	messagesToSend.push(...groupHistory);

	try{
		const resp = await fetch('/api/chat', {
			method: 'POST', headers: {'Content-Type':'application/json'},
			body: JSON.stringify({messages: messagesToSend}),
		});
		if(!resp.ok) return;
		const reader = resp.body.getReader();
		const dec = new TextDecoder();
		let assistantText = '';
		while(true){
			const {done, value} = await reader.read();
			if(done) break;
			const chunk = dec.decode(value, {stream:true});
			const parts = chunk.split('\n').filter(Boolean);
			for(const p of parts){
				try{ const j = JSON.parse(p); if(j.response) assistantText += j.response; }
				catch(e){ assistantText += p; }
			}
		}
		// parse lines into speaker utterances, collect replies and display sequentially
		const lines = assistantText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
		const replies = [];
		for(const ln of lines){
			const m = ln.match(/^([^:：]+)[:：]\s*(.+)$/);
			if(m){
				const name = m[1].trim(); const content = m[2].trim();
				replies.push({name, content});
			}else{
				replies.push({name: 'assistant', content: ln});
			}
		}
		if(replies.length > 0){
			displaySequentialReplies(contact, replies);
		}
	}catch(e){ console.error('group response error', e); }
}

function startAutoChat(){
	const contact = contacts.find(c=>c.id === 'group');
	if(!contact) return;
	if(!inputLines || inputLines.length === 0) return;
	// recursive scheduler
	(function scheduleNext(){
		const interval = GROUP_SCHEDULE_MIN_INTERVAL + Math.floor(Math.random() * (GROUP_SCHEDULE_MAX_INTERVAL - GROUP_SCHEDULE_MIN_INTERVAL));
		setTimeout(()=>{
			const line = inputLines[Math.floor(Math.random()*inputLines.length)];
				if(line){
					// treat the line as an instruction fed to the model; ask personas to randomly reply
					triggerGroupResponseWithInstruction(contact, line);
				}
			scheduleNext();
		}, interval);
	})();
}

async function loadAllPromptsAndAssignRandom(){
	// collect non-group contacts
	const personaContacts = contacts.filter(c=>c.id && c.id !== 'group');
	if(personaContacts.length === 0) return;

	// fetch all prompt files in parallel (based on known ids)
	const fetches = personaContacts.map(c=>
		fetch(`./prompts/${c.id}.md`).then(r=> r.ok ? r.text() : '').catch(()=>''));

	const texts = await Promise.all(fetches);

	// shuffle texts and assign to contacts that don't already have prompt
	const shuffled = texts.slice();
	for(let i = shuffled.length - 1; i > 0; i--){
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	let idx = 0;
	for(const c of personaContacts){
		if(c.prompt) { idx++; continue; }
		const t = shuffled[idx] || '';
		if(t) c.prompt = t.trim();
		idx++;
	}
}

function renderChatForActiveContact(){
	messagesEl.innerHTML = '';
	const contact = contacts.find(c => c.id === activeContactId);
	if(!contact) return;
	// group consecutive messages where time gap < 60s
	const groups = [];
	let current = null;
	for(const m of contact.messages){
		if(!m.ts) m.ts = Date.now();
		if(!current){
			current = {startTs: m.ts, msgs: [m]};
		}else{
			const last = current.msgs[current.msgs.length-1];
			if(m.ts - last.ts < GROUP_GROUP_THRESHOLD_MS){
				current.msgs.push(m);
			}else{
				groups.push(current);
				current = {startTs: m.ts, msgs: [m]};
			}
		}
	}
	if(current) groups.push(current);

	for(const g of groups){
		// create group container
		const groupEl = document.createElement('div');
		groupEl.className = 'msg-group';
		// show group timestamp (use first message time)
		const timeEl = document.createElement('div');
		timeEl.className = 'meta';
		const d = new Date(g.startTs);
		timeEl.textContent = d.toLocaleTimeString();
		groupEl.appendChild(timeEl);

		for(const m of g.msgs){
			const role = (m.role === 'user') ? 'user' : 'assistant';
			if(m.role && m.role !== 'assistant' && m.role !== 'user'){
				// named speaker, show meta as speaker name
				groupEl.appendChild(createBubbleElement('assistant', m.content, {meta: m.role}));
			}else{
				groupEl.appendChild(createBubbleElement(role, m.content, {}));
			}
		}
		messagesEl.appendChild(groupEl);
	}
}

function appendBubble(role, content, opts={}){
	// opts.target: optional contact id this message belongs to
	const target = opts.target || activeContactId;
	// only render to DOM if target chat is currently active
	if(target !== activeContactId && !opts.force){
		return null;
	}
	const row = createBubbleElement(role, content, opts);
	messagesEl.appendChild(row);
	scrollToBottom();
	return row.querySelector('.bubble');
}

function createBubbleElement(role, content, opts={}){
	const row = document.createElement('div');
	row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');

	const bubble = document.createElement('div');
	bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
	bubble.innerHTML = escapeHtml(content);
	if(opts.ts){
		bubble.setAttribute('title', new Date(opts.ts).toLocaleString());
		bubble.dataset.ts = String(opts.ts);
	}

	row.appendChild(bubble);

	if(opts.meta){
		const meta = document.createElement('div');
		meta.className = 'meta';
		meta.textContent = opts.meta;
		row.appendChild(meta);
	}

	return row;
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

	// add user bubble locally with timestamp
	const now = Date.now();
	appendBubble('user', text, {ts: now});
	contact.messages.push({role:'user', content:text, ts: now});

	// clear input
	userInput.value = '';
	userInput.style.height = 'auto';

	isProcessing = true;
	sendButton.disabled = true;

	const assistantBubble = appendBubble('assistant', '', {target: contact.id});

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
			if(assistantBubble){ assistantBubble.innerHTML = escapeHtml(assistantText); scrollToBottom(); }
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
						const now = Date.now();
						contact.messages.push({role: name, content, ts: now});
						appendBubble('assistant', content, {meta: name, ts: now, target: contact.id});
					}else{
						const now = Date.now();
						contact.messages.push({role:'assistant', content: ln, ts: now});
						appendBubble('assistant', ln, {ts: now, target: contact.id});
					}
				}
			}else{
				contact.messages.push({role:'assistant', content: assistantText, ts: Date.now()});
				// append to DOM only if this chat is active
				appendBubble('assistant', assistantText, {ts: Date.now(), target: contact.id});
			}
	}catch(err){
		console.error(err);
		if(assistantBubble){ assistantBubble.innerHTML = '请求失败，请稍后重试。'; }
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
