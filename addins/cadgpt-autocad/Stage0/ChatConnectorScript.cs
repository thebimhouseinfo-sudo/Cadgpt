using System;
using System.Text;

namespace CadGpt.AutoCad.Stage0
{
    internal static class ChatConnectorScript
    {
        public const string AdapterVersion = "single-chat-mention-v1";

        public static string BuildSendTurnScript(string instruction)
        {
            var encoded = Convert.ToBase64String(
                Encoding.UTF8.GetBytes(instruction ?? string.Empty));

            return @"(async () => {
try {
  const suffixBytes = Uint8Array.from(atob('" + encoded + @"'), c => c.charCodeAt(0));
  const suffix = new TextDecoder('utf-8').decode(suffixBytes);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden';
  };
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const firstLine = (value) => (value || '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) || '';
  const candidateName = (el) => norm(
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    firstLine(el.textContent)
  );
  const composers = () => [...document.querySelectorAll('textarea,[contenteditable=""true""]')]
    .filter(visible)
    .filter((el) => {
      const role = norm(el.getAttribute('role'));
      const placeholder = norm(el.getAttribute('placeholder'));
      const testId = norm(el.getAttribute('data-testid'));
      return el.tagName.toLowerCase() === 'textarea' ||
        role === 'textbox' ||
        placeholder.includes('message') ||
        placeholder.includes('prompt') ||
        testId.includes('composer');
    });

  let composerList = composers();
  if (composerList.length !== 1) {
    return {
      success:false,
      code:composerList.length === 0 ? 'COMPOSER_NOT_FOUND' : 'COMPOSER_AMBIGUOUS',
      count:composerList.length
    };
  }

  let composer = composerList[0];
  composer.focus();
  if (composer.tagName.toLowerCase() === 'textarea') {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (!setter) return { success:false, code:'COMPOSER_SETTER_UNAVAILABLE' };
    setter.call(composer, '@cg');
  } else {
    composer.textContent = '@cg';
  }
  composer.dispatchEvent(new InputEvent('input', {
    bubbles:true,
    inputType:'insertText',
    data:'@cg'
  }));

  await wait(450);

  const suggestions = [...document.querySelectorAll(
    '[role=""option""],[role=""menuitem""],button,a'
  )]
    .filter(visible)
    .filter((el) => {
      const name = candidateName(el);
      return name === 'cg' || name === 'cadgpt';
    });

  if (suggestions.length !== 1) {
    return {
      success:false,
      code:suggestions.length === 0
        ? 'CG_CONNECTOR_NOT_FOUND'
        : 'CG_CONNECTOR_AMBIGUOUS',
      count:suggestions.length
    };
  }

  suggestions[0].click();
  await wait(250);

  composerList = composers();
  if (composerList.length !== 1) {
    return {
      success:false,
      code:composerList.length === 0
        ? 'COMPOSER_LOST_AFTER_CONNECTOR'
        : 'COMPOSER_AMBIGUOUS_AFTER_CONNECTOR',
      count:composerList.length
    };
  }

  composer = composerList[0];
  composer.focus();
  if (suffix) {
    const text = ' ' + suffix;
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {
      inserted = false;
    }

    if (!inserted) {
      if (composer.tagName.toLowerCase() === 'textarea') {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        if (!setter) return { success:false, code:'COMPOSER_APPEND_UNAVAILABLE' };
        setter.call(composer, (composer.value || '') + text);
      } else {
        composer.textContent = (composer.textContent || '') + text;
      }
      composer.dispatchEvent(new InputEvent('input', {
        bubbles:true,
        inputType:'insertText',
        data:text
      }));
    }
  }

  await wait(120);

  const sendCandidates = [...document.querySelectorAll('button,[role=""button""]')]
    .filter(visible)
    .filter((el) => {
      const name = candidateName(el);
      const testId = norm(el.getAttribute('data-testid'));
      return name === 'send' ||
        name === 'send message' ||
        testId === 'send-button';
    });

  if (sendCandidates.length !== 1) {
    return {
      success:false,
      code:sendCandidates.length === 0 ? 'SEND_NOT_FOUND' : 'SEND_AMBIGUOUS',
      count:sendCandidates.length
    };
  }

  sendCandidates[0].click();
  return {
    success:true,
    code:'OK',
    method:'mention-exact',
    url:location.href
  };
} catch (error) {
  return {
    success:false,
    code:'SCRIPT_EXCEPTION',
    name:(error && error.name) ? error.name : 'Error'
  };
}
})();";
        }
    }
}
