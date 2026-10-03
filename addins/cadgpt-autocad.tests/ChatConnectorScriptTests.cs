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
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            StringAssert.Contains(script, "suggestions.length !== 1");
            StringAssert.Contains(script, "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(script, "CG_CONNECTOR_AMBIGUOUS");
            StringAssert.Contains(script, "name === 'cg' || name === 'cadgpt'");
        }

        [TestMethod]
        public void SendsOnlyBareCadGptInvocation()
        {
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            StringAssert.Contains(script, "setter.call(composer, '@cg')");
            StringAssert.DoesNotContain(script, "connect drawing");
            StringAssert.DoesNotContain(script, "new chat");
            StringAssert.DoesNotContain(script, "new conversation");
        }

        [TestMethod]
        public void DoesNotAccessCredentialsStorageOrNetworkApis()
        {
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            StringAssert.DoesNotContain(script, "document.cookie");
            StringAssert.DoesNotContain(script, "localStorage");
            StringAssert.DoesNotContain(script, "sessionStorage");
            StringAssert.DoesNotContain(script, "indexedDB");
            StringAssert.DoesNotContain(script, "fetch(");
            StringAssert.DoesNotContain(script, "XMLHttpRequest");
        }
    }
}
