using CadGpt.AutoCad.Stage0;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class PaletteLifecycleTests
    {
        [TestMethod]
        public void BeginInitializationTwiceKeepsOneGeneration()
        {
            var state = new PaletteLifecycleState();
            var first = state.BeginInitialization();
            var second = state.BeginInitialization();

            Assert.AreEqual(first, second);
            Assert.AreEqual(PaletteLifecyclePhase.Initializing, state.Phase);
        }

        [TestMethod]
        public void ReadyStateDoesNotStartANewInitialization()
        {
            var state = new PaletteLifecycleState();
            var first = state.BeginInitialization();
            Assert.IsTrue(state.MarkReady(first));

            var second = state.BeginInitialization();

            Assert.AreEqual(first, second);
            Assert.AreEqual(PaletteLifecyclePhase.Ready, state.Phase);
        }

        [TestMethod]
        public void DisposeInvalidatesLateInitializationCompletion()
        {
            var state = new PaletteLifecycleState();
            var initialization = state.BeginInitialization();

            var dispose = state.BeginDispose();
            var lateReady = state.MarkReady(initialization);
            state.CompleteDispose(dispose);

            Assert.IsFalse(lateReady);
            Assert.AreEqual(PaletteLifecyclePhase.Closed, state.Phase);
        }

        [TestMethod]
        public void FailureCanRetryWithNewGeneration()
        {
            var state = new PaletteLifecycleState();
            var first = state.BeginInitialization();
            Assert.IsTrue(state.MarkFailed(first, "WEBVIEW_INIT_FAILED"));

            var retry = state.BeginInitialization();

            Assert.IsTrue(retry > first);
            Assert.AreEqual(PaletteLifecyclePhase.Initializing, state.Phase);
            Assert.IsNull(state.FailureCode);
        }

        [TestMethod]
        public void StaleFailureCannotOverrideNewGeneration()
        {
            var state = new PaletteLifecycleState();
            var first = state.BeginInitialization();
            var dispose = state.BeginDispose();
            state.CompleteDispose(dispose);
            var second = state.BeginInitialization();

            Assert.IsFalse(state.MarkFailed(first, "STALE"));
            Assert.AreEqual(PaletteLifecyclePhase.Initializing, state.Phase);
            Assert.IsTrue(state.IsCurrent(second));
        }
    }
}
