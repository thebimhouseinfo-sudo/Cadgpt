using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatConnectorScriptTests
    {
        [TestMethod]
        public void PairingScriptInvokesBareCadGptOnly()
        {
            var script =
                ChatConnectorScript.InvokeCadGpt();

            StringAssert.Contains(
                script,
                "setter.call(composer, '@cg')");
            StringAssert.Contains(
                script,
                "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(
                script,
                "suggestions.length !== 1");
            StringAssert.DoesNotContain(
                script,
                "connect drawing");
            StringAssert.DoesNotContain(
                script.ToLowerInvariant(),
                "new chat");
        }

        [TestMethod]
        public void PairingScriptDoesNotReadSecretsOrUseNetworkApis()
        {
            var script =
                ChatConnectorScript.InvokeCadGpt();

            StringAssert.DoesNotContain(
                script,
                "document.cookie");
            StringAssert.DoesNotContain(
                script,
                "localStorage");
            StringAssert.DoesNotContain(
                script,
                "sessionStorage");
            StringAssert.DoesNotContain(
                script,
                "indexedDB");
            StringAssert.DoesNotContain(
                script,
                "XMLHttpRequest");
            StringAssert.DoesNotContain(
                script,
                "fetch(");
        }
    }
}
