(() => {
const { api, onGenerationEvent } = window.SyncAI;
const byId = id => document.getElementById(id);
const promptInput = byId("quickAskPrompt");
const form = byId("quickAskForm");
const sendButton = byId("quickAskSend");
const stopButton = byId("quickAskStop");
const answerWrap = byId("quickAskAnswerWrap");
const answer = byId("quickAskAnswer");
const answerState = byId("quickAskAnswerState");
const status = byId("quickAskModelState");
const errorBox = byId("quickAskError");
const modelLabel = byId("quickAskModelLabel");
let ready = false;
let generating = false;
let generationId = null;
let unsubscribe = null;

function setError(message) {
  errorBox.textContent = message || "";
  errorBox.hidden = !message;
}
function setStatus(message, kind = "ready") {
  status.className = "quick-ask-model-state is-" + kind;
  status.querySelector("span:last-child").textContent = message;
}
function setGenerating(value) {
  generating = value;
  sendButton.disabled = !ready || generating || !promptInput.value.trim();
  promptInput.disabled = !ready || generating;
  stopButton.hidden = !generating;
  stopButton.disabled = false;
  answerState.textContent = generating ? "GENERATING" : "RESPONSE";
}
async function prepare() {
  ready = false;
  setGenerating(false);
  setStatus("Preparing local inference…", "loading");
  setError("");
  try {
    const result = await api.quickAskPrepare();
    ready = true;
    const source = result.reusedExistingModel ? "Reusing your loaded model" : "Temporary model loaded";
    setStatus(source + " · " + result.modelName, "ready");
    modelLabel.textContent = result.temporary ? "TEMPORARY MODEL · UNLOADS ON CLOSE" : "REUSING LOADED MODEL";
    promptInput.disabled = false;
    sendButton.disabled = !promptInput.value.trim();
    promptInput.focus();
  } catch (error) {
    ready = false;
    setGenerating(false);
    setStatus("Model unavailable", "error");
    setError(error instanceof Error ? error.message : String(error));
    modelLabel.textContent = "CHECK LOCAL MODELS / SETTINGS";
    byId("quickAskRetry")?.remove();
    const retry = document.createElement("button");
    retry.type = "button";
    retry.id = "quickAskRetry";
    retry.className = "quick-ask-retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => { retry.remove(); void prepare(); });
    errorBox.insertAdjacentElement("afterend", retry);
  }
}
async function submit() {
  const message = promptInput.value.trim();
  if (!message || !ready || generating) return;
  setError("");
  answerWrap.hidden = false;
  answer.textContent = "";
  generationId = crypto.randomUUID();
  setGenerating(true);
  setStatus("Thinking locally…", "loading");
  try {
    const result = await api.quickAskSubmit(message, generationId);
    answer.textContent = result?.text || result?.diagnostics?.errorMessage || "The model returned an empty response.";
    if (result?.diagnostics?.status === "error") {
      setStatus("Response failed", "error");
      setError(result.diagnostics.errorMessage || "Quick Ask could not complete.");
    } else {
      setStatus("Ready · " + (result?.diagnostics?.modelLabel || "local model"), "ready");
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    setStatus("Quick Ask failed", "error");
  } finally {
    generationId = null;
    setGenerating(false);
    promptInput.focus();
  }
}
form.addEventListener("submit", event => { event.preventDefault(); void submit(); });
promptInput.addEventListener("input", () => {
  sendButton.disabled = !ready || generating || !promptInput.value.trim();
});
promptInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
stopButton.addEventListener("click", async () => {
  if (!generating || !generationId) return;
  stopButton.disabled = true;
  try { await api.quickAskStop(); }
  catch (error) { setError(error instanceof Error ? error.message : String(error)); }
});
byId("quickAskClose").addEventListener("click", () => { void api.quickAskClose(); });
unsubscribe = onGenerationEvent(event => {
  if (!event || event.purpose !== "quick-ask" || event.generationId !== generationId) return;
  if (event.event === "started") setStatus("Thinking locally…", "loading");
  if (event.event === "token" && typeof event.text === "string") {
    answerWrap.hidden = false;
    answer.textContent = event.text;
  }
  if (event.event === "failed") setStatus("Response failed", "error");
  if (event.event === "cancelled") setStatus("Stopped", "ready");
});
window.addEventListener("beforeunload", () => { try { unsubscribe?.(); } catch {} });
void prepare();
})();
