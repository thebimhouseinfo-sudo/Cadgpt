using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CadGpt.AutoCad.Stage0
{
    public sealed class DrawingIdentityValue
    {
        public string? Name { get; set; }
        public string? FullName { get; set; }
    }

    public static class DrawingIdentityMatcher
    {
        public static string? NormalizePath(
            string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var normalized =
                value.Trim()
                    .Replace('/', '\\');

            if (normalized.StartsWith(
                    @"\\?\",
                    StringComparison.OrdinalIgnoreCase))
            {
                normalized =
                    normalized.Substring(4);
            }

            try
            {
                normalized =
                    Path.GetFullPath(normalized);
            }
            catch
            {
                // AutoCAD can expose a path while the document is still
                // transitioning. Keep the best normalized string rather than
                // turning a transient path formatting issue into "closed".
            }

            return normalized
                .TrimEnd('\\')
                .ToUpperInvariant();
        }

        public static bool Matches(
            DrawingIdentityValue bound,
            DrawingIdentityValue candidate,
            IReadOnlyCollection<DrawingIdentityValue>
                openDrawings)
        {
            var boundPath =
                NormalizePath(bound.FullName);
            var candidatePath =
                NormalizePath(candidate.FullName);

            if (
                boundPath != null &&
                candidatePath != null)
            {
                return string.Equals(
                    boundPath,
                    candidatePath,
                    StringComparison.OrdinalIgnoreCase);
            }

            var boundName =
                NormalizeName(bound.Name);
            var candidateName =
                NormalizeName(candidate.Name);
            if (
                boundName == null ||
                candidateName == null ||
                !string.Equals(
                    boundName,
                    candidateName,
                    StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            return openDrawings.Count(
                item =>
                    string.Equals(
                        NormalizeName(item.Name),
                        boundName,
                        StringComparison.OrdinalIgnoreCase)) ==
                1;
        }

        private static string? NormalizeName(
            string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            return value.Trim().ToUpperInvariant();
        }
    }
}
