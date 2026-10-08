using System;
using CadGpt.AutoCad.Stage0;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class BindingHeaderEvidenceTests
    {
        [TestMethod]
        public void HundredsOfStableAndUnknownPollsNeverChangeNormalHeader()
        {
            var state = new BindingHeaderEvidence();
            for (var i = 0; i < 5000; i++)
            {
                state.Observe(true, true);
                state.ObserveUnknown(); // HTTP timeout, partial snapshot, sleep/wake
            }

            Assert.IsFalse(state.BoundDrawingClosed);
            Assert.IsFalse(state.DifferentTabActive);
        }

        [TestMethod]
        public void DifferentTabRequiresTwoCompleteSnapshotsAndClearsOnReturn()
        {
            var state = new BindingHeaderEvidence();
            state.Observe(true, true);
            state.Observe(true, false);
            Assert.IsFalse(state.DifferentTabActive);
            state.ObserveUnknown();
            Assert.IsFalse(state.DifferentTabActive);

            state.Observe(true, false);
            Assert.IsTrue(state.DifferentTabActive);
            Assert.IsFalse(state.BoundDrawingClosed);
            state.Observe(true, true);
            Assert.IsFalse(state.DifferentTabActive);
        }

        [TestMethod]
        public void ClosedWarningRequiresThreeCompleteMissingSnapshots()
        {
            var state = new BindingHeaderEvidence();
            state.Observe(true, true);
            state.Observe(false, null);
            state.ObserveUnknown();
            state.Observe(false, null);
            Assert.IsFalse(state.BoundDrawingClosed);
            state.Observe(false, null);
            Assert.IsTrue(state.BoundDrawingClosed);
            Assert.IsFalse(state.DifferentTabActive);
            state.Observe(true, null);
            Assert.IsFalse(state.BoundDrawingClosed);
        }

        [TestMethod]
        public void OneInterruptedDocumentTransitionCannotBecomeOrangeOrYellow()
        {
            var state = new BindingHeaderEvidence();
            state.Observe(true, true);
            state.Observe(false, false);
            state.Observe(true, true);
            state.Observe(true, false);
            state.Observe(true, true);
            Assert.IsFalse(state.BoundDrawingClosed);
            Assert.IsFalse(state.DifferentTabActive);
        }

        [TestMethod]
        public void ChangeBoundDocumentResetsHistoricalEvidence()
        {
            var state = new BindingHeaderEvidence();
            state.Observe(false, null);
            state.Observe(false, null);
            state.Reset();
            state.Observe(false, null);
            Assert.IsFalse(state.BoundDrawingClosed);
        }

        [TestMethod]
        public void UnclaimedPairWindowIsStableUntilExpiry()
        {
            var expires = new DateTime(2026, 10, 8, 12, 3, 0, DateTimeKind.Utc);
            for (var elapsed = 0; elapsed < 180; elapsed += 3)
            {
                var now = expires.AddSeconds(-180 + elapsed);
                Assert.IsFalse(
                    AddinPairRenewalPolicy.ShouldRenew(false, expires, now),
                    "pending ChatGPT pair must not rotate during polling");
            }
            Assert.IsTrue(AddinPairRenewalPolicy.ShouldRenew(false, expires, expires));
        }

        [TestMethod]
        public void ConfirmedPairRevocationReconnectsImmediatelyButTransportGapDoesNot()
        {
            var now = DateTime.UtcNow;
            Assert.IsTrue(AddinPairRenewalPolicy.ShouldRenew(true, now.AddMinutes(3), now));
            Assert.IsTrue(AddinPairRenewalPolicy.ShouldRenew(false, DateTime.MinValue, now));
            Assert.IsFalse(AddinPairRenewalPolicy.ShouldRenew(false, now.AddMinutes(3), now));
        }
    }
}
