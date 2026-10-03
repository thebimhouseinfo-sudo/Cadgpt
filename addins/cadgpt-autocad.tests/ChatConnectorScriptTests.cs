using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatConnectorScriptTests
    {
        [TestMethod]
        public void PairingScriptsOnlyPrepareAndSelectBareCadGpt()
        {
            var prepare =
                ChatConnectorScript.PrepareComposer();
            var select =
                ChatConnectorScript.SelectCadGptSuggestion();
            var refocus =
                ChatConnectorScript.RefocusComposer();

            StringAssert.Contains(
                prepare,
                "COMPOSER_NOT_EMPTY");
            StringAssert.Contains(
                select,
                "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(
                select,
                "CG_CONNECTOR_AMBIGUOUS");
            StringAssert.Contains(
                select,
                "value === 'cg'");
            StringAssert.Contains(
                refocus,
                "COMPOSER_LOST_AFTER_CONNECTOR");

            var combined =
                prepare + select + refocus;
            Assert.IsFalse(
                combined.Contains("connect drawing"));
            Assert.IsFalse(
                combined.ToLowerInvariant().Contains("new chat"));
        }

        [TestMethod]
        public void PairingScriptsDoNotReadSecretsOrUseNetworkApis()
        {
            var combined =
                ChatConnectorScript.PrepareComposer() +
                ChatConnectorScript.SelectCadGptSuggestion() +
                ChatConnectorScript.RefocusComposer();

            Assert.IsFalse(
                combined.Contains("document.cookie"));
            Assert.IsFalse(
                combined.Contains("localStorage"));
            Assert.IsFalse(
                combined.Contains("sessionStorage"));
            Assert.IsFalse(
                combined.Contains("indexedDB"));
            Assert.IsFalse(
                combined.Contains("XMLHttpRequest"));
            Assert.IsFalse(
                combined.Contains("fetch("));
        }
    }
}
