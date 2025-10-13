export function playHtmlTemplate(title: string, buildId?: string) {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />",
    `  <title>${title}</title>`,
    "  <link rel=\"stylesheet\" href=\"./styles.css\" />",
    "</head>",
    "<body class=\"dark\">",
    "  <div id=\"root\"></div>",
    "  <script type=\"module\" src=\"./__name-shim.js\"></script>",
    "  <script type=\"module\" src=\"./bootstrap.js\"></script>",
    process.env.DEV_ADMIN_HTML === '1' && buildId
      ? `  <a href=\"/admin?buildId=${buildId}\">Admin Review</a>`
      : "",
    "</body>",
    "</html>",
  ].join("\n");
}
