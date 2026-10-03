using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatNavigationScriptTests
    {
        [TestMethod]
        public void NewChatRequiresExactlyOneVisibleExactMatch()
        {
            var script = ChatNavigationScript.NewChat();

            StringAssert.Contains(script, "candidates.length !== 1");
            StringAssert.Contains(script, "NEW_CHAT_NOT_FOUND");
            StringAssert.Contains(script, "NEW_CHAT_AMBIGUOUS");
            StringAssert.Contains(script, "v === 'new chat'");
        }

        [TestMethod]
        public void InvocationRequiresActualConnectorSelectionBeforeSend()
        {
            var script = ChatNavigationScript.InvokeCadGpt();

            StringAssert.Contains(script, "tools-menu-exact");
            StringAssert.Contains(script, "mention-suggestion-exact");
            StringAssert.Contains(script, "CONNECTOR_SUGGESTION_NOT_FOUND");
            StringAssert.Contains(script, "suggestions.length !== 1");
            StringAssert.Contains(script, "sendCandidates.length !== 1");
        }

        [TestMethod]
        public void AdapterDoesNotAccessBrowserSecretsOrNetworkApis()
        {
            var combined = ChatNavigationScript.NewChat() + ChatNavigationScript.InvokeCadGpt();

            StringAssert.DoesNotContain(combined, "document.cookie");
            StringAssert.DoesNotContain(combined, "localStorage");
            StringAssert.DoesNotContain(combined, "sessionStorage");
            StringAssert.DoesNotContain(combined, "indexedDB");
            StringAssert.DoesNotContain(combined, "fetch(");
            StringAssert.DoesNotContain(combined, "XMLHttpRequest");
            StringAssert.DoesNotContain(combined, "performance.getEntries");
        }
    }
}
