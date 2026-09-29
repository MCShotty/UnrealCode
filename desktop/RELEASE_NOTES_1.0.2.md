# UnrealCode 1.0.2

This update repairs stale document/review results, quiets optional warnings, and improves the Browser and non-Git project experience.

- **Warning controls:** turn off warning popups in Settings → Appearance, or use **Silence warnings** on an advisory notice. The setting survives restart. Task failures, data problems, approvals and required answers remain visible.
- **Browser:** a compact responsive tab bar and address toolbar, a useful first-page guide, and a separate Agent access dialog with reliable focus restoration.
- **Git:** plain folders remain usable without repeated background Git error notices. Repository readiness and GitHub login are reported separately; unavailable status is never called a clean working tree.
- **PDFs and OCR:** delayed results stay with their original page, and obsolete text layers are cancelled during navigation.
- **Reviews:** delayed pull-request details no longer replace a newer selection.
- **Recovery:** Open settings reaches the provider tab, and finishing one recovery action cannot dismiss a newer issue. Appearance changes do not reconfigure decision/MCP services.

The Windows installer is unsigned. Install manually; release notifications open the release page and do not download or run installers. Check the published SHA-256 manifest and build attestation when available. Existing releases are preserved.

Automated Windows UI checks run in hidden windows. They do not establish native desktop placement or full assistive-technology acceptance.
