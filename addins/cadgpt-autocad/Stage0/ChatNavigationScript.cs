using System;

namespace CadGpt.AutoCad.Stage0
{
    internal static class ChatNavigationScript
    {
        public const string AdapterVersion = "stage0-dom-v1";

        public static string NewChat()
        {
            return Wrap(@"
const visible = (el) => {
  const r = el.getBoundingClientRect();
  const s = window.getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
};
const norm = (v) => (v || '').replace(/\s+/g, ' ').trim().toLowerCase();
const label = (el) => norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
const all = [...document.querySelectorAll('button,a,[role=""button""]')].filter(visible);
const candidates = all.filter((el) => {
  const v = label(el);
  return v === 'new chat' || v === 'new conversation';
});
if (candidates.length !== 1) {
  return { success:false, code:candidates.length === 0 ? 'NEW_CHAT_NOT_FOUND' : 'NEW_CHAT_AMBIGUOUS', count:candidates.length };
}
candidates[0].click();
await new Promise((resolve) => setTimeout(resolve, 500));
return { success:true, code:'OK', method:'exact-accessible-new-chat', url:location.href };
");
        }

        public static string InvokeCadGpt()
        {
            return Wrap(@"
const visible = (el) => {
  const r = el.getBoundingClientRect();
  const s = window.getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
};
const norm = (v) => (v || '').replace(/\s+/g, ' ').trim().toLowerCase();
const label = (el) => norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
const exactConnector = (el) => {
  const v = label(el);
  return v === 'cg' || v === 'cadgpt';
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let connectorMethod = null;
const controls = [...document.querySelectorAll('button,[role=""button""]')].filter(visible);
const toolButtons = controls.filter((el) => {
  const v = label(el);
  return v === 'tools' || v === 'use tools' || v === 'connectors' || v === 'apps';
});
if (toolButtons.length === 1) {
  toolButtons[0].click();
  await wait(350);
  const connectorCandidates = [...document.querySelectorAll('[role=""menuitem""],[role=""option""],button,a')]
    .filter(visible)
    .filter(exactConnector);
  if (connectorCandidates.length > 1) {
    return { success:false, code:'CONNECTOR_AMBIGUOUS', count:connectorCandidates.length };
  }
  if (connectorCandidates.length === 1) {
    connectorCandidates[0].click();
    connectorMethod = 'tools-menu-exact';
    await wait(250);
  }
} else if (toolButtons.length > 1) {
  return { success:false, code:'TOOLS_BUTTON_AMBIGUOUS', count:toolButtons.length };
}

const composerCandidates = [...document.querySelectorAll('textarea,[contenteditable=""true""]')]
  .filter(visible)
  .filter((el) => {
    const role = norm(el.getAttribute('role'));
    const placeholder = norm(el.getAttribute('placeholder'));
    const dataId = norm(el.getAttribute('data-testid'));
    return (
      el.tagName.toLowerCase() === 'textarea' ||
      role === 'textbox' ||
      placeholder.includes('message') ||
      placeholder.includes('prompt') ||
      dataId.includes('composer')
    );
  });
if (composerCandidates.length !== 1) {
  return { success:false, code:composerCandidates.length === 0 ? 'COMPOSER_NOT_FOUND' : 'COMPOSER_AMBIGUOUS', count:composerCandidates.length };
}
const composer = composerCandidates[0];

if (!connectorMethod) {
  composer.focus();
  if (composer.tagName.toLowerCase() === 'textarea') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) return { success:false, code:'COMPOSER_SETTER_UNAVAILABLE' };
    setter.call(composer, '@cg');
  } else {
    composer.textContent = '@cg';
  }
  composer.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:'@cg' }));
  await wait(400);
  const suggestions = [...document.querySelectorAll('[role=""option""],[role=""menuitem""],button')]
    .filter(visible)
    .filter(exactConnector);
  if (suggestions.length !== 1) {
    return { success:false, code:suggestions.length === 0 ? 'CONNECTOR_SUGGESTION_NOT_FOUND' : 'CONNECTOR_SUGGESTION_AMBIGUOUS', count:suggestions.length };
  }
  suggestions[0].click();
  connectorMethod = 'mention-suggestion-exact';
  await wait(250);
}

composer.focus();
const prompt = '@cg';
if (composer.tagName.toLowerCase() === 'textarea') {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) return { success:false, code:'COMPOSER_SETTER_UNAVAILABLE' };
  setter.call(composer, prompt);
} else {
  composer.textContent = prompt;
}
composer.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:prompt }));
await wait(150);

const sendCandidates = [...document.querySelectorAll('button,[role=""button""]')]
  .filter(visible)
  .filter((el) => {
    const v = label(el);
    const testId = norm(el.getAttribute('data-testid'));
    return v === 'send' || v === 'send message' || testId === 'send-button';
  });
if (sendCandidates.length !== 1) {
  return { success:false, code:sendCandidates.length === 0 ? 'SEND_NOT_FOUND' : 'SEND_AMBIGUOUS', count:sendCandidates.length };
}
sendCandidates[0].click();
return { success:true, code:'OK', method:connectorMethod, url:location.href };
");
        }

        private static string Wrap(string body)
        {
            return "(async () => { try { " + body +
                   " } catch (error) { return { success:false, code:'SCRIPT_EXCEPTION', name:(error && error.name) ? error.name : 'Error' }; } })();";
        }
    }
}
