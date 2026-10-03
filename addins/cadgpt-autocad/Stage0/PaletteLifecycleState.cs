using System;

namespace CadGpt.AutoCad.Stage0
{
    public enum PaletteLifecyclePhase
    {
        Closed,
        Initializing,
        Ready,
        Failed,
        Disposing
    }

    public sealed class PaletteLifecycleState
    {
        private readonly object _gate = new object();
        private int _generation;

        public PaletteLifecyclePhase Phase { get; private set; } = PaletteLifecyclePhase.Closed;
        public string? FailureCode { get; private set; }

        public int BeginInitialization()
        {
            lock (_gate)
            {
                if (Phase == PaletteLifecyclePhase.Initializing || Phase == PaletteLifecyclePhase.Ready)
                {
                    return _generation;
                }

                _generation++;
                FailureCode = null;
                Phase = PaletteLifecyclePhase.Initializing;
                return _generation;
            }
        }

        public bool MarkReady(int generation)
        {
            lock (_gate)
            {
                if (generation != _generation || Phase != PaletteLifecyclePhase.Initializing)
                {
                    return false;
                }

                Phase = PaletteLifecyclePhase.Ready;
                FailureCode = null;
                return true;
            }
        }

        public bool MarkFailed(int generation, string failureCode)
        {
            if (string.IsNullOrWhiteSpace(failureCode))
            {
                throw new ArgumentException("A stable failure code is required.", nameof(failureCode));
            }

            lock (_gate)
            {
                if (generation != _generation || Phase != PaletteLifecyclePhase.Initializing)
                {
                    return false;
                }

                Phase = PaletteLifecyclePhase.Failed;
                FailureCode = failureCode;
                return true;
            }
        }

        public int BeginDispose()
        {
            lock (_gate)
            {
                _generation++;
                Phase = PaletteLifecyclePhase.Disposing;
                return _generation;
            }
        }

        public void CompleteDispose(int generation)
        {
            lock (_gate)
            {
                if (generation != _generation || Phase != PaletteLifecyclePhase.Disposing)
                {
                    return;
                }

                Phase = PaletteLifecyclePhase.Closed;
                FailureCode = null;
            }
        }

        public bool IsCurrent(int generation)
        {
            lock (_gate)
            {
                return generation == _generation;
            }
        }
    }
}
