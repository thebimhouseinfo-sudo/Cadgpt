using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class WebViewProfileTests
    {
        [TestMethod]
        public void NormalizesStandardConversationAndDropsQueryAndFragment()
        {
            var value = WebViewProfile.NormalizeConversationUrl("https://chatgpt.com/c/abc-123?model=x#fragment");

            Assert.AreEqual("https://chatgpt.com/c/abc-123", value);
        }

        [TestMethod]
        public void AcceptsConversationNestedUnderCustomGptPath()
        {
            var value = WebViewProfile.NormalizeConversationUrl("https://chatgpt.com/g/g-cadgpt/c/abc-123");

            Assert.AreEqual("https://chatgpt.com/g/g-cadgpt/c/abc-123", value);
        }

        [DataTestMethod]
        [DataRow("https://chatgpt.com/")]
        [DataRow("https://chatgpt.com/auth/login?code=secret")]
        [DataRow("http://chatgpt.com/c/abc")]
        [DataRow("https://example.com/c/abc")]
        [DataRow("https://chatgpt.com:444/c/abc")]
        public void RejectsNonConversationOrNonCanonicalUrls(string value)
        {
            Assert.IsNull(WebViewProfile.NormalizeConversationUrl(value));
        }
    }
}
