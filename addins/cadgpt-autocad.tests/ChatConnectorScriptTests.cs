using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatConnectorScriptTests
    {
        [TestMethod]
        public void RequiresExactlyOneVisibleCadGptConnectorCandidate()
        {
            var script = ChatConnectorScript.BuildSendTurnScript(string.Empty);

            StringAssert.Contains(script, "suggestions.length !== 1");
            StringAssert.Contains(script, "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(script, "CG_CONNECTOR_AMBIGUOUS");
            StringAssert.Contains(script, "name === 'cg' || name === 'cadgpt'");
        }

        [TestMethod]
        public void DoesNotCreateOrNavigateToNewChat()
        {
            var script = ChatConnectorScript.BuildSendTurnScript("connect drawing: Drawing1.dwg");

            StringAssert.DoesNotContain(script, "new chat");
            StringAssert.DoesNotContain(script, "new conversation");
            StringAssert.DoesNotContain(script, "location.href =");
            StringAssert.DoesNotContain(script, ".navigate");
        }

        [TestMethod]
        public void DoesNotAccessCredentialsStorageOrNetworkApis()
        {
            var script = ChatConnectorScript.BuildSendTurnScript("connect drawing: Drawing1.dwg");

            StringAssert.DoesNotContain(script, "document.cookie");
            StringAssert.DoesNotContain(script, "localStorage");
            StringAssert.DoesNotContain(script, "sessionStorage");
            StringAssert.DoesNotContain(script, "indexedDB");
            StringAssert.DoesNotContain(script, "fetch(");
            StringAssert.DoesNotContain(script, "XMLHttpRequest");
        }

        [TestMethod]
        public void UserInstructionIsEncodedBeforeEmbeddingInJavascript()
        {
            const string instruction = "connect drawing: C:\\Jobs\\A drawing.dwg";
            var script = ChatConnectorScript.BuildSendTurnScript(instruction);

            StringAssert.DoesNotContain(script, instruction);
            StringAssert.Contains(script, "atob('");
            StringAssert.Contains(script, "TextDecoder('utf-8')");
        }
    }
}
