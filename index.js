
$(function () {

	/* -------- (A) 무음 오디오 keep-alive -------- */
	function startKeepAlive() {
		const src =
			"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
		const audio = new Audio(src);
		audio.loop = true;
		audio.volume = 0;
		audio.play().catch(() => { });
	}


	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced'
	});

	/* ▶️ pre 태그 → ``` … ```  변환 보강 ◀️ */
	td.addRule('preToCodeBlock', {
		filter: node => node.nodeName === 'PRE',
		replacement: (content, node) => {
			// 1) 언어 감지 :  <pre data-language="js">  /  <code class="language-python">
			let lang = '';
			const codeNode = node.querySelector('code');
			if (codeNode) {
				const m = (codeNode.className || '').match(/language-([\w-]+)/);
				if (m) lang = m[1];
			} else if (node.getAttribute('data-language')) {
				lang = node.getAttribute('data-language');
			}

			// 2) 실제 코드 텍스트
			const text = node.textContent.replace(/\n$/, '');        // 끝 줄바꿈 하나 제거

			// 3) 펜스드 블록 반환
			return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
		}
	});



	var api_server = "";

	/* ---------- 0. 전역 상태 ---------- */
	let isRunning = false;        // 로직 가동 여부
	let queue = [];           // 작업 대기열

	/* ---------- 1. 유틸 ---------- */
	const sleep = ms => new Promise(r => setTimeout(r, ms));

	const getList = () =>
		fetch(api_server + '/gpt/list.php')
			.then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

	const popList = () => {
		const idx = queue.findIndex(v => Number(v.status) === 0);
		return idx === -1 ? null : queue.splice(idx, 1)[0];
	};

	const writeAndSend = async ({ chapter }) => {
		$('#prompt-textarea p').html(chapter);
		await sleep(500);
		$('#composer-submit-button').click();
	};

	/* const waitAnswer = () =>
		new Promise((res, rej) => {
			const id = setInterval(async () => {
				const done = $('#composer-submit-button').length === 0;
				if (done) {
					clearInterval(id);
					setTimeout(async () => {
						try {
							$('[data-testid="copy-turn-action-button"]').last().click();
							await sleep(400);                               // 복사 반영 대기
							res(await navigator.clipboard.readText());
						} catch (e) {
							rej('클립보드 읽기 실패: ' + e);
						}
					}, 600);
				}
			}, 800);
			setTimeout(() => { clearInterval(id); rej('timeout'); }, 120000);
		}); */

	/* 답변 대기 + Markdown 추출 */
	const waitAnswer = () => new Promise((resolve, reject) => {
		const started = Date.now();
		const intv = setInterval(async () => {
			if ($('#composer-submit-button').length !== 0) {
				if (Date.now() - started > 120000) {  // 2분 초과
					cleanup('timeout');
				}
				return;
			}

			try {
				if (!document.hasFocus()) window.focus();   // 포커스 확보
				$('[data-testid="copy-turn-action-button"]').last().click();
				await sleep(400);
				const clip = await navigator.clipboard.readText();
				if (clip.trim()) return cleanup(null, clip);  // 성공
			} catch (e) {
			}

			const $md = $('.markdown').last();
			if ($md.length) {
				const md = td.turndown($md.html().trim());
				if (md.trim()) return cleanup(null, md);
			}

			cleanup('클립보드·DOM 모두 실패');
		}, 800);

		function cleanup(err, value = '') {
			clearInterval(intv);
			if (err) return reject(err);
			resolve(value);
		}
	});

	/* 답변 완료 대기 + Markdown 추출 */
	/* const waitAnswer = () => new Promise((resolve, reject) => {
		const started = Date.now();
		const intv = setInterval(() => {
			if ($('#composer-submit-button').length !== 0) {
				if (Date.now() - started > 120000) {      // 2 분 초과 시 종료
					cleanup('timeout');
				}
				return;
			}

			const $md = $('.markdown').last();
			if (!$md.length) return;                    // 아직 생성 안 됨

			if ($md.closest('.result-streaming').length) return;

			const md = td.turndown($md.html().trim());
			if (md.trim()) return cleanup(null, md);

			cleanup('Markdown 추출 실패');
		}, 800);

		function cleanup(err, value = '') {
			clearInterval(intv);
			err ? reject(err) : resolve(value);
		}
	}); */

	const postAnswer = ({ no, answer }) =>
		$.post(api_server + '/gpt/insert.php', {
			no,          // 숫자 그대로
			answer       // 마크다운 전문
		});
	const panel = $(`
	  <div id="gpt-auto-panel"
		   style="position:fixed;bottom:20px;right:20px;z-index:9999;
				  background:#2d2d2d;color:#fff;padding:12px 16px;
				  border-radius:8px;font:14px/1.4 sans-serif;
				  box-shadow:0 4px 8px rgba(0,0,0,.25);">
		<div style="margin-bottom:8px">
		  <strong>GPT Auto&nbsp;</strong>
		  <span id="gpt-status" style="color:#ffeb3b;">IDLE</span>
		</div>
		<button id="btn-start" style="margin-right:6px">START</button>
		<button id="btn-stop"  disabled>STOP</button>
	  </div>
	`).appendTo('body');

	const $status = $('#gpt-status'),
		$btnStart = $('#btn-start'),
		$btnStop = $('#btn-stop');

	function setStatus(txt, color = '#ffeb3b') {
		$status.text(txt).css('color', color);
	}

	/* ---------- 3. 메인 루프 ---------- */
	async function mainLoop() {
		try {
			setStatus('FETCH', '#03a9f4');
			const { list = [] } = await getList();
			queue = list;                              // 새로 고침
			if (!queue.length) throw 'Queue empty';

			while (isRunning) {
				const item = popList();
				if (!item) { setStatus('DONE', '#4caf50'); break; }

				setStatus('SEND', '#00e676');
				await writeAndSend(item);

				let answer;
				try {
					answer = await waitAnswer();
				} catch (e) {
					console.error(e);
					setStatus('ERROR', '#ff5252');
					break;
				}

				await postAnswer({ no: item.no, answer });
				setStatus(`OK (#${item.no})`, '#cddc39');
				await sleep(1000);                       // 과부하 방지
			}
		} catch (e) {
			console.warn('루프 종료:', e);
			setStatus('STOPPED', '#ff9800');
		} finally {
			isRunning = false;
			$btnStart.prop('disabled', false);
			$btnStop.prop('disabled', true);
		}
	}

	/* ---------- 4. 버튼 이벤트 ---------- */
	$btnStart.on('click', () => {
		isRunning = true;
		$btnStart.prop('disabled', true);
		$btnStop.prop('disabled', false);
		setStatus('INIT', '#ffc107');
		mainLoop();
	});

	$btnStop.on('click', () => {
		isRunning = false;
		setStatus('STOP cmd', '#ff5722');
	});

});
