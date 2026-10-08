using System;

namespace CadGpt.AutoCad.Stage0
{
    /// <summary>
    /// Prevents replacing a still-valid, unclaimed pairing window every
    /// time the panel polls. A previously confirmed pair can be renewed
    /// immediately when the server explicitly revokes it.
    /// </summary>
    public static class AddinPairRenewalPolicy
    {
        public static bool ShouldRenew(
            bool wasConfirmed,
            bool serverStillPending,
            DateTime pendingExpiresUtc,
            DateTime nowUtc)
        {
            return wasConfirmed ||
                   !serverStillPending ||
                   pendingExpiresUtc == DateTime.MinValue ||
                   nowUtc >= pendingExpiresUtc;
        }
    }
}
