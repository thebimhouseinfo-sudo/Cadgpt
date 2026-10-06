using System.Collections.Generic;
using CadGpt.AutoCad.Stage0;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class DrawingIdentityMatcherTests
    {
        [TestMethod]
        public void NormalizesSlashCaseAndExtendedPrefix()
        {
            var left =
                DrawingIdentityMatcher.NormalizePath(
                    @"\\?\C:\Projects\MAGS.dwg");
            var right =
                DrawingIdentityMatcher.NormalizePath(
                    @"c:/projects/MAGS.dwg");

            Assert.AreEqual(left, right);
        }

        [TestMethod]
        public void FallsBackToUniqueNameWhenOnePathIsUnavailable()
        {
            var bound =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName = null,
                };
            var candidate =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\Projects\MAGS.dwg",
                };
            var open =
                new List<DrawingIdentityValue>
                {
                    candidate,
                    new DrawingIdentityValue
                    {
                        Name = "Other.dwg",
                        FullName =
                            @"C:\Projects\Other.dwg",
                    },
                };

            Assert.IsTrue(
                DrawingIdentityMatcher.Matches(
                    bound,
                    candidate,
                    open));
        }

        [TestMethod]
        public void UsesUniqueNameFallbackAfterPathMismatch()
        {
            var bound =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\API-A\MAGS.dwg",
                };
            var candidate =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\API-B\MAGS.dwg",
                };

            Assert.IsTrue(
                DrawingIdentityMatcher.Matches(
                    bound,
                    candidate,
                    new[]
                    {
                        candidate,
                    }));
        }

        [TestMethod]
        public void DoesNotCollapseDuplicatedNamesAcrossDifferentPaths()
        {
            var bound =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\A\MAGS.dwg",
                };
            var candidate =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\B\MAGS.dwg",
                };
            var duplicate =
                new DrawingIdentityValue
                {
                    Name = "MAGS.dwg",
                    FullName =
                        @"C:\C\MAGS.dwg",
                };

            Assert.IsFalse(
                DrawingIdentityMatcher.Matches(
                    bound,
                    candidate,
                    new[]
                    {
                        candidate,
                        duplicate,
                    }));
        }
    }
}
