using System;

namespace CadGpt.AutoCad.Stage0
{
    internal static class ChatConnectorScript
    {
        public const string AdapterVersion =
            "single-chat-pair-v1";

        public static string InvokeCadGpt()
        {
            return @"(async () => {
try {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  };
  const norm = (value) =>
    (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const label = (el) => norm(
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent
  );
  const composers = [...document.querySelectorAll(
    'textarea,[contenteditable=""true""]'
  )]
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

  if (composers.length !== 1) {
    return {
      success:false,
      code:composers.length === 0
        ? 'COMPOSER_NOT_FOUND'
        : 'COMPOSER_AMBIGUOUS',
      count:composers.length
    };
  }

  const composer = composers[0];
  composer.focus();
  if (composer.tagName.toLowerCase() === 'textarea') {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (!setter) {
      return {
        success:false,
        code:'COMPOSER_SETTER_UNAVAILABLE'
      };
    }
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
      const value = label(el);
      return value === 'cg' ||
        value === 'cadgpt' ||
        value.startsWith('cg ') ||
        value.startsWith('cadgpt ');
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

  const sendCandidates =
    [...document.querySelectorAll(
      'button,[role=""button""]'
    )]
      .filter(visible)
      .filter((el) => {
        const value = label(el);
        const testId =
          norm(el.getAttribute('data-testid'));
        return value === 'send' ||
          value === 'send message' ||
          testId === 'send-button';
      });

  if (sendCandidates.length !== 1) {
    return {
      success:false,
      code:sendCandidates.length === 0
        ? 'SEND_NOT_FOUND'
        : 'SEND_AMBIGUOUS',
      count:sendCandidates.length
    };
  }

  sendCandidates[0].click();
  return {
    success:true,
    code:'OK',
    method:'mention-exact'
  };
} catch (error) {
  return {
    success:false,
    code:'SCRIPT_EXCEPTION',
    name:(error && error.name)
      ? error.name
      : 'Error'
  };
}
})();";
        }
    }
}
