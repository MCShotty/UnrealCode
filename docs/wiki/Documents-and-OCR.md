# Documents and OCR

Open **Documents** to read a project PDF or explicitly choose an external PDF. The reader provides page navigation, zoom, search, text selection, and page-linked references.

## Read and attach

- Enter a project-relative PDF path or choose an external file.
- If it needs a password, enter it for this open document. Passwords remain in memory.
- Read or search selected pages.
- Explicitly attach an external document before asking the agent to access it.

Agent document tools are limited to trusted-project PDFs or explicitly attached documents. They provide bounded metadata, page text, search, and selected-page OCR. Opening a PDF is not permission to ingest it into memory or send the entire document to a model.

## OCR

For a scanned PDF page, choose English or Arabic and run OCR. Tesseract processing stays local in workers; verified language data downloads on demand. Parsing and OCR support cancellation and bounded work.

Embedded text and OCR text are labelled separately. Check confidence and verify important values against the page. Tables, handwriting, mixed scripts, and tiny print need extra care.

Image attachments need a vision-capable model. The OCR skill supplies guidance, while the Documents reader's local OCR control works on selected PDF pages.

## Markdown and limits

Use the file editor and Markdown preview for project Markdown. The built-in `markdown`, `pdf-reading`, `pdf-parsing`, and `ocr` skills provide reusable guidance.

PDF scripting is disabled. Editing, signing, and submitting PDF forms are outside this version. Extraction caches are rebuildable; document contents are not automatically remembered.
