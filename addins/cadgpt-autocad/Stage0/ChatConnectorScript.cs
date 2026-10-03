using System;

namespace CadGpt.AutoCad.Stage0
{
    internal static class ChatConnectorScript
    {
        public const string AdapterVersion =
            "single-chat-pair-v2";

        public static string PrepareComposer()
        {
            return @"(() => {
try {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  };
  const norm = (value) =>
    (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

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
  const current = composer.tagName.toLowerCase() === 'textarea'
    ? composer.value
    : composer.textContent;
  if ((current || '').trim().length > 0) {
    return {
      success:false,
      code:'COMPOSER_NOT_EMPTY'
    };
  }

  composer.focus();
  return {
    success:true,
    code:'OK',
    method:'focus-composer'
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

        public static string SelectCadGptSuggestion()
        {
            return @"(() => {
try {
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

  const candidates = [...document.querySelectorAll(
    '[role=""option""],[role=""menuitem""],[data-radix-collection-item],button,a'
  )]
    .filter(visible)
    .filter((el) => {
      const value = label(el);
      return value === 'cg' ||
        value === 'cadgpt' ||
        value.startsWith('cg ') ||
        value.startsWith('cadgpt ');
    });

  if (candidates.length !== 1) {
    const samples = [...document.querySelectorAll(
      '[role=""option""],[role=""menuitem""],[data-radix-collection-item],button,a'
    )]
      .filter(visible)
      .map((el) => label(el))
      .filter((value) =>
        value.includes('cg') ||
        value.includes('cadgpt')
      )
      .slice(0, 8);

    return {
      success:false,
      code:candidates.length === 0
        ? 'CG_CONNECTOR_NOT_FOUND'
        : 'CG_CONNECTOR_AMBIGUOUS',
      count:candidates.length,
      samples:samples
    };
  }

  candidates[0].click();
  return {
    success:true,
    code:'OK',
    method:'exact-visible-suggestion'
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

        public static string RefocusComposer()
        {
            return @"(() => {
try {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  };
  const composers = [...document.querySelectorAll(
    'textarea,[contenteditable=""true""]'
  )].filter(visible);

  if (composers.length !== 1) {
    return {
      success:false,
      code:composers.length === 0
        ? 'COMPOSER_LOST_AFTER_CONNECTOR'
        : 'COMPOSER_AMBIGUOUS_AFTER_CONNECTOR',
      count:composers.length
    };
  }

  composers[0].focus();
  return {
    success:true,
    code:'OK',
    method:'refocus-composer'
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
