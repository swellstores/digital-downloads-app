/**
 * The uploader page. Plain HTML and browser JS: the browser PUTs file parts
 * directly to the bucket using URLs this worker presigns, reads each part's
 * ETag (the bucket's CORS rules must expose it), then asks the worker to
 * finish the upload and save the deliverable.
 */
export function uploaderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload files</title>
<style>
:root{--text:#1d1d1b;--muted:#6b6b66;--line:#e4e4df;--bg:#fff;--soft:#f6f6f4;--accent:#1d1d1b;--accent-text:#fff;--danger:#b42318;--ok:#067647}
@media (prefers-color-scheme:dark){:root{--text:#f0f0ec;--muted:#a3a39c;--line:#33332f;--bg:#1f1f1d;--soft:#141413;--accent:#f0f0ec;--accent-text:#141413;--danger:#f97066;--ok:#47cd89}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;padding:24px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:24px 0 8px}
p{margin:0 0 12px}
.muted{color:var(--muted)}
.notice{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:12px}
.drop{display:block;border:2px dashed var(--line);border-radius:12px;padding:32px 16px;text-align:center;cursor:pointer}
.drop.over{border-color:var(--accent)}
.drop input{display:none}
label.field{display:block;margin:16px 0 4px;font-weight:600}
input[type=text],select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:8px;margin-top:16px}
button{background:var(--accent);color:var(--accent-text);border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}
button:disabled{opacity:.4;cursor:not-allowed}
.bar{height:8px;background:var(--soft);border-radius:4px;overflow:hidden;margin:16px 0 4px}
.bar div{height:100%;width:0;background:var(--accent);transition:width .2s}
ul{list-style:none;margin:0;padding:0}
li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.error{color:var(--danger)}
.done{color:var(--ok)}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <h1 id="title">Upload files</h1>
  <p class="muted" id="subtitle">Loading…</p>
  <p class="notice" id="setup" hidden>Connect a bucket first: open Apps → Digital Downloads → File storage, fill in your bucket details, save, then choose Actions → Test connection.</p>

  <section id="uploader" hidden>
    <label class="drop" id="drop">
      <input type="file" id="file">
      <strong id="drop-label">Choose a file or drag it here</strong>
      <div class="muted" id="drop-hint">Files go straight to your bucket. Large files are fine.</div>
    </label>

    <label class="field" for="target">Upload as</label>
    <select id="target"><option value="">A new deliverable</option></select>

    <div id="name-field">
      <label class="field" for="name">Name shown to buyers</label>
      <input type="text" id="name" maxlength="200" placeholder="Defaults to the file name">
    </div>

    <div class="row">
      <button id="start" disabled>Upload</button>
      <button id="cancel" class="secondary" hidden>Cancel</button>
    </div>

    <div id="progress" hidden>
      <div class="bar"><div id="bar"></div></div>
      <p class="muted" id="progress-text"></p>
    </div>
    <p id="message"></p>

    <h2>Uploaded files</h2>
    <ul id="files"></ul>
    <p class="muted" id="no-files">None yet.</p>
  </section>
</main>
<script>
(function () {
  var productId = (location.pathname.match(/\\/upload\\/([0-9a-f]{24})/i) || [])[1];
  var api = location.pathname.replace(/\\/upload\\/[0-9a-f]{24}\\/?$/i, "") + "/uploader-api";
  var $ = function (id) { return document.getElementById(id); };
  var file = null;
  var upload = null;
  var CONCURRENCY = 4;
  var RETRIES = 3;

  function request(method, path, body) {
    return fetch(api + path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
        return data;
      });
    });
  }

  function formatSize(bytes) {
    if (bytes == null) return "";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return (i ? bytes.toFixed(1) : bytes) + " " + units[i];
  }

  function setMessage(text, kind) {
    $("message").textContent = text || "";
    $("message").className = kind || "";
  }

  function render(product) {
    $("title").textContent = "Upload files for " + product.name;
    $("subtitle").textContent = "Buyers get these on their downloads page after paying.";
    $("setup").hidden = product.storage_ready;
    $("uploader").hidden = !product.storage_ready;

    var target = $("target");
    var files = $("files");
    target.length = 1;
    files.textContent = "";

    product.deliverables.forEach(function (deliverable) {
      var option = document.createElement("option");
      option.value = deliverable.id;
      option.textContent = "Replace " + deliverable.name;
      target.appendChild(option);

      if (deliverable.source === "bucket") {
        var item = document.createElement("li");
        var name = document.createElement("span");
        name.textContent = deliverable.name + (deliverable.filename ? " (" + deliverable.filename + ")" : "");
        var size = document.createElement("span");
        size.className = "muted";
        size.textContent = formatSize(deliverable.size);
        item.appendChild(name);
        item.appendChild(size);
        files.appendChild(item);
      }
    });

    $("no-files").hidden = files.children.length > 0;
  }

  function load() {
    return request("GET", "/products/" + productId).then(render).catch(function (err) {
      $("subtitle").textContent = err.message;
      $("subtitle").className = "error";
    });
  }

  function choose(selected) {
    file = selected || null;
    $("drop-label").textContent = file ? file.name : "Choose a file or drag it here";
    $("drop-hint").textContent = file ? formatSize(file.size) : "Files go straight to your bucket. Large files are fine.";
    $("start").disabled = !file;
    setMessage("");
  }

  function putPart(url, blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.upload.onprogress = function (event) { onProgress(event.loaded); };
      xhr.onload = function () {
        var etag = xhr.getResponseHeader("ETag");
        if (xhr.status < 200 || xhr.status >= 300) {
          return reject(new Error("The bucket rejected a part (" + xhr.status + ")"));
        }
        if (!etag) {
          return reject(new Error("The bucket didn't expose the ETag header. Add ETag to the CORS rule's exposed headers."));
        }
        resolve(etag);
      };
      xhr.onerror = function () { reject(new Error("Couldn't reach the bucket. Check its CORS rules allow PUT from this page.")); };
      xhr.onabort = function () { reject(new Error("Canceled")); };
      upload.requests.push(xhr);
      xhr.send(blob);
    });
  }

  function start() {
    if (!file || upload) return;

    var current = file;
    var replaceId = $("target").value;
    var loaded = {};
    var startedAt = Date.now();

    upload = { requests: [], canceled: false };
    $("start").disabled = true;
    $("cancel").hidden = false;
    $("progress").hidden = false;
    setMessage("");

    function progress() {
      var total = 0;
      for (var key in loaded) total += loaded[key];
      var percent = current.size ? Math.min(100, Math.round(total / current.size * 100)) : 100;
      var seconds = (Date.now() - startedAt) / 1000;
      $("bar").style.width = percent + "%";
      $("progress-text").textContent = percent + "% of " + formatSize(current.size) +
        (seconds > 2 ? " · " + formatSize(total / seconds) + "/s" : "");
    }

    var state;

    request("POST", "/uploads", {
      product_id: productId,
      filename: current.name,
      size: current.size,
      content_type: current.type || "application/octet-stream"
    }).then(function (started) {
      state = started;
      var count = Math.max(1, Math.ceil(current.size / started.part_size));
      var queue = [];
      for (var n = 1; n <= count; n++) queue.push(n);
      var urls = {};
      var parts = [];
      var fetching = Promise.resolve();

      // One batch request at a time, each covering this part and the next ones queued
      function urlFor(partNumber) {
        var next = fetching.catch(function () {}).then(function () {
          if (urls[partNumber]) return;
          var batch = [partNumber].concat(queue).filter(function (n, i, all) {
            return !urls[n] && all.indexOf(n) === i;
          }).slice(0, 50);
          return request("POST", "/uploads/parts", {
            key: state.key, upload_id: state.upload_id, part_numbers: batch
          }).then(function (result) {
            for (var key in result.urls) urls[key] = result.urls[key];
          });
        });
        fetching = next;
        return next.then(function () { return urls[partNumber]; });
      }

      function send(partNumber, attempt) {
        var begin = (partNumber - 1) * state.part_size;
        var blob = current.slice(begin, Math.min(begin + state.part_size, current.size));
        return urlFor(partNumber).then(function (url) {
          return putPart(url, blob, function (bytes) { loaded[partNumber] = bytes; progress(); });
        }).catch(function (err) {
          if (upload.canceled || attempt >= RETRIES) throw err;
          loaded[partNumber] = 0;
          delete urls[partNumber];
          return new Promise(function (resolve) { setTimeout(resolve, 1000 * attempt); })
            .then(function () { return send(partNumber, attempt + 1); });
        });
      }

      function worker() {
        var partNumber = queue.shift();
        if (partNumber === undefined) return Promise.resolve();
        return send(partNumber, 1).then(function (etag) {
          parts.push({ part_number: partNumber, etag: etag });
          return worker();
        });
      }

      var workers = [];
      for (var w = 0; w < Math.min(CONCURRENCY, count); w++) workers.push(worker());
      return Promise.all(workers).then(function () { return parts; });
    }).then(function (parts) {
      $("progress-text").textContent = "Finishing…";
      return request("POST", "/uploads/complete", {
        product_id: productId,
        deliverable_id: replaceId || undefined,
        key: state.key,
        upload_id: state.upload_id,
        parts: parts,
        name: $("name").value,
        filename: current.name,
        size: current.size,
        content_type: current.type || "application/octet-stream"
      });
    }).then(function () {
      setMessage(replaceId
        ? "Replaced. Buyers' existing links now download the new file."
        : "Uploaded. Reload the product page to see it under Digital delivery.", "done");
      $("name").value = "";
      choose(null);
      return load();
    }).catch(function (err) {
      if (state) request("POST", "/uploads/abort", { key: state.key, upload_id: state.upload_id }).catch(function () {});
      setMessage(upload && upload.canceled ? "Upload canceled." : err.message, upload && upload.canceled ? "" : "error");
    }).then(function () {
      upload = null;
      $("cancel").hidden = true;
      $("progress").hidden = true;
      $("start").disabled = !file;
    });
  }

  $("file").addEventListener("change", function (event) { choose(event.target.files[0]); });
  $("target").addEventListener("change", function () { $("name-field").hidden = Boolean($("target").value); });
  $("start").addEventListener("click", start);
  $("cancel").addEventListener("click", function () {
    if (!upload) return;
    upload.canceled = true;
    upload.requests.forEach(function (xhr) { xhr.abort(); });
  });

  var drop = $("drop");
  drop.addEventListener("dragover", function (event) { event.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (event) {
    event.preventDefault();
    drop.classList.remove("over");
    if (event.dataTransfer.files[0]) choose(event.dataTransfer.files[0]);
  });

  window.addEventListener("beforeunload", function (event) {
    if (upload) { event.preventDefault(); event.returnValue = ""; }
  });

  if (productId) load();
  else $("subtitle").textContent = "Open a product, then choose Actions → Upload files.";
})();
</script>
</body>
</html>`;
}
