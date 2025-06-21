/* global $, crypto */
class ChatGPTAutomator {
	/* ===== 1) 초기 설정 ===== */
	constructor(opts = {}) {
		this._conversationId = opts.conversationId ?? "a77582d0-7eaa-49ad-853f-bb7ec1fa47fd";
		this._parentMessageId = opts.parentMessageId ?? "7f5f31e7-eeef-4a98-bae5-6fccb4e48d9a";

		this.list = []; this.index = 0; this.accessToken = null;
		this.answerBuffer = "";

		this.navRoot = document.querySelector("nav > div:nth-child(1)") || document.body;
	}

	/* ===== 2) 퍼블릭 진입점 ===== */
	async init(delay = 3000) {
		await this.sleep(delay);
		this.list = await this.fetchList();
		this.injectUI();
		this.bindButton();
		this.accessToken = await this.fetchSessionToken();
		await this.runList();
	}

	/* ===== 3) 메인 루프 ===== */
	async runList() {
		if (this.answerBuffer) { await this.postAnswer(this.answerBuffer); this.answerBuffer = ""; }
		if (!this.list[this.index]) return;

		const chapter = this.list[this.index++].chapter;
		const question = this.createQuestion(chapter);
		const payload = this.buildConversationPayloadV2(question);

		const firstRes = await this.sendConversation(payload);
		this.answerBuffer += firstRes.message.content.parts[0];

		this.parentMessageId = firstRes.message.id;   // setter가 UI 동기화
		await this.pollUntilEnd(payload.conversation_id, firstRes.message.id);
		await this.runList();
	}

	/* ===== 4) 스트리밍 ===== */
	async pollUntilEnd(cid, pid) {
		let cursor = pid;
		while (true) {
			const res = await this.sendContinue(cid, cursor);
			this.answerBuffer += res.message.content.parts[0];
			if (res.message.end_turn) break;
			cursor = res.message.id;
		}
		this.parentMessageId = cursor;          // 마지막 ID 저장
	}

	/* ===== 5) 네트워크 ===== */
	async fetchList() { return (await fetch("https://wooah.synology.me/gpt/list.php").then(r => r.json())).list; }
	async fetchSessionToken() { return (await fetch("https://chatgpt.com/api/auth/session").then(r => r.json())).accessToken; }
	async postAnswer(ans) { return new Promise(res => $.post("https://wooah.synology.me/gpt/insert.php", { content: JSON.stringify(String(ans)) }, res)); }
	async sendConversation(p) { return this.postChatGPT("/backend-api/conversation", p); }
	async sendContinue(cid, pid) {
		const p = {
			action: "continue", conversation_id: cid, parent_message_id: pid, model: "gpt-4o",
			timezone_offset_min: -540, timezone: "Asia/Seoul", supports_buffering: true, supported_encodings: ["v1"]
		};
		return this.postChatGPT("/backend-api/conversation", p);
	}
	async postChatGPT(url, body) {
		const txt = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.text());
		const arr = txt.split("data: ");
		return JSON.parse(arr[arr.length - 2]);
	}

	/* ===== 6) UI ===== */
	injectUI() {
		$(this.navRoot).append(`
		<aside id="auto-panel" class="w-[90%] mx-auto mt-3 mb-3 bg-gray-800 text-white border border-gray-600 rounded-md p-3 flex flex-col gap-2 text-xs">
		  <button id="run" class="px-3 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white">RUN</button>
  
		  <input name="conversation_id2"  placeholder="conversation_id"         class="input-field">
		  <input name="parent_message_id" placeholder="parent_message_id"       class="input-field">
		  <input name="message_id"        placeholder="message_id"              class="input-field">
		  <input name="messages_content_parts" placeholder="messages_content_parts" class="input-field">
		</aside>`);

		const $c = $('#auto-panel [name=conversation_id2]');
		const $p = $('#auto-panel [name=parent_message_id]');
		const $m = $('#auto-panel [name=message_id]');

		$c.val(this.conversationId);
		$p.val(this.parentMessageId);
		$m.val(ChatGPTAutomator.uuid());             // 최초 UUID

		/* UI → 필드 */
		$c.on('input', e => { this._conversationId = e.target.value.trim(); });
		$p.on('input', e => { this._parentMessageId = e.target.value.trim(); });
	}

	bindButton() { $('#auto-panel #run').on('click', () => this.runList()); }

	/* ===== 7) 빌더 ===== */
	createQuestion(t) {
		return `"${t}" 에 대하여 아래 조건에 맞춰 답변해주세요
  조건1 : 한글로 답변해주세요,
  조건2 : 주제에 대하여 소제목과, 예시를첨부하면서 답변해주세요,
  조건3 : 비유적인 표현을 사용해서 쉽게 이해할수 있도록 답변해주세요,
  조건4 : 최대한 많은 내용을 답변해주세요,
  조건5 : "친근한 말투를 이용한 존댓말"을 반드시 이용해 활기찬 분위기로 답변해주세요,
  조건6 : 블로그에 사용할 마크다운 포멧으로 최소 2000자 이상 자세하고 친절하게 답변해주세요.
  조건7 : 해당내용의 주의해야할점을 보기쉽게 정리해서 마무리해주세요.`;
	}

	buildConversationPayloadV2(q) {
		/* message_id UI 갱신 */
		const msgId = ChatGPTAutomator.uuid();
		$('#auto-panel [name=message_id]').val(msgId);

		return {
			action: "next",
			messages: [{
				id: msgId, author: { role: "user" }, create_time: Date.now() / 1000,
				content: { content_type: "text", parts: [q] },
				metadata: {
					selected_sources: [], selected_github_repos: [], selected_all_github_repos: false,
					serialization_metadata: { custom_symbol_offsets: [] }
				}
			}],
			conversation_id: this.conversationId,
			parent_message_id: this.parentMessageId,
			model: "gpt-4o",
			timezone_offset_min: -540, timezone: "Asia/Seoul",
			conversation_mode: { kind: "primary_assistant" },
			enable_message_followups: true, supports_buffering: true, supported_encodings: ["v1"],
			client_contextual_info: {
				is_dark_mode: matchMedia("(prefers-color-scheme: dark)").matches,
				time_since_loaded: Math.round(performance.now() / 1000), page_height: innerHeight, page_width: innerWidth,
				pixel_ratio: devicePixelRatio || 1, screen_height: screen.height, screen_width: screen.width
			},
			paragen_cot_summary_display_override: "allow", effort_mode: "default",
			infer_request_id: ChatGPTAutomator.uuid()
		};
	}

	/* ===== 8) 양방향 동기화 ===== */
	get conversationId() { return this._conversationId; }
	set conversationId(v) { this._conversationId = v; $('#auto-panel [name=conversation_id2]').val(v); }
	get parentMessageId() { return this._parentMessageId; }
	set parentMessageId(v) { this._parentMessageId = v; $('#auto-panel [name=parent_message_id]').val(v); }

	/* ===== 9) 유틸 ===== */
	sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
	static uuid() { const a = new Uint16Array(8); (crypto || msCrypto).getRandomValues(a); return [...a].map((x, i) => x.toString(16).padStart(4, "0") + ([1, 2, 3, 4].includes(i) ? "-" : "")).join("") }
}

/* ---------- 실행 ---------- */
$(document).ready(() => { new ChatGPTAutomator().init(); });