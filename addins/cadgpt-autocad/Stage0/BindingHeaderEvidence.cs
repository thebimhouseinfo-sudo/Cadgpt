namespace CadGpt.AutoCad.Stage0
{
    /// <summary>
    /// Visual drawing state is based only on complete local AutoCAD snapshots.
    /// Missing/partial snapshots and HTTP timeouts are not evidence of a
    /// closed or inactive document. No wall-clock idle timeout is involved.
    /// </summary>
    public sealed class BindingHeaderEvidence
    {
        private int _missingSnapshots;
        private int _inactiveSnapshots;

        public bool BoundDrawingClosed { get; private set; }
        public bool DifferentTabActive { get; private set; }

        public void Reset()
        {
            _missingSnapshots = 0;
            _inactiveSnapshots = 0;
            BoundDrawingClosed = false;
            DifferentTabActive = false;
        }

        public void Observe(bool boundOpen, bool? boundIsActive)
        {
            if (!boundOpen)
            {
                _missingSnapshots++;
                _inactiveSnapshots = 0;
                DifferentTabActive = false;
                if (_missingSnapshots >= 3)
                    BoundDrawingClosed = true;
                return;
            }

            _missingSnapshots = 0;
            BoundDrawingClosed = false;
            if (!boundIsActive.HasValue)
                return;

            if (boundIsActive.Value)
            {
                _inactiveSnapshots = 0;
                DifferentTabActive = false;
            }
            else
            {
                _inactiveSnapshots++;
                if (_inactiveSnapshots >= 2)
                    DifferentTabActive = true;
            }
        }

        // Do not change the last confirmed status for an incomplete snapshot.
        public void ObserveUnknown() { }
    }
}
