
(function() {
  const queryString = new URLSearchParams(location.search)
  const libraryBase = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.1.81/build/"

  document.addEventListener("webviewerloaded", function() {
    PDFViewerApplicationOptions.set("workerSrc", libraryBase + "pdf.worker.min.js")
    PDFViewerApplicationOptions.set("sandboxBundleSrc", libraryBase + "pdf.sandbox.min.js")
    PDFViewerApplicationOptions.set("defaultUrl", null)
  })

  PDFViewerApplication.initializedPromise
    .then(function() {
      if (queryString.has("embedded")) initEmbeddedApi()
      else initStandaloneApi()
    })



  /**
   * Standalone API is invoked by content script injected into standalone viewer
   */
  function initStandaloneApi() {
    const documentReady = selectFile().then(loadDocument)
    const queue = new EventQueue("PdfDoc");
    queue
      .on("loadDocument", function() {
        documentReady
          .then(() => queue.trigger("documentLoaded"))
      })
      .on("getCurrentIndex", function() {
        getCurrentIndex.apply(null, arguments)
          .then(index => queue.trigger("currentIndexGot", index))
      })
      .on("getTexts", function() {
        getTexts.apply(null, arguments)
          .then(texts => queue.trigger("textsGot", texts))
      })
  }

  function EventQueue(prefix) {
    this.on = function(eventType, callback) {
      document.addEventListener(prefix+eventType, function(event) {
        callback.apply(null, JSON.parse(event.detail));
      })
      return this;
    }
    this.once = function(eventType, callback) {
      var handler = function(event) {
        document.removeEventListener(prefix+eventType, handler);
        callback.apply(null, JSON.parse(event.detail));
      };
      document.addEventListener(prefix+eventType, handler);
      return this;
    }
    this.trigger = function(eventType) {
      var args = Array.prototype.slice.call(arguments, 1);
      document.dispatchEvent(new CustomEvent(prefix+eventType, {detail: JSON.stringify(args)}));
      return this;
    }
  }



  /**
   * Embedded API is invoked by parent window of embedded viewer
   */
  function initEmbeddedApi() {
    window.addEventListener("message", event => {
      if (event.data.method == "loadDocument") {
        loadDocument(URL.createObjectURL(new Blob([event.data.buffer])))
          .then(() => event.source.postMessage({id: event.data.id}, event.origin))
      }
      else if (event.data.method == "getCurrentIndex") {
        getCurrentIndex()
          .then(index => event.source.postMessage({id: event.data.id, value: index}, event.origin))
      }
      else if (event.data.method == "getTexts") {
        getTexts(event.data.index, event.data.quietly)
          .then(texts => event.source.postMessage({id: event.data.id, value: texts}, event.origin))
      }
    })
    if (parent) parent.postMessage({method: "viewerReady"}, "*")
  }



  /**
   * API methods
   */
  async function loadDocument(url) {
    if (PDFViewerApplication.url == url) return
    if (/^file:/.test(url)) url = await uploadFile()
    PDFViewerApplication.open(url)
    await new Promise(f => PDFViewerApplication.eventBus.on("pagesloaded", f))
  }

  function getCurrentIndex() {
    var pageNo = PDFViewerApplication.pdfViewer.currentPageNumber;
    return Promise.resolve(pageNo ? pageNo-1 : 0);
  }

  async function getTexts(index, quietly) {
    const pdf = PDFViewerApplication.pdfDocument;
    if (index < pdf.numPages) {
      if (!quietly) PDFViewerApplication.pdfViewer.currentPageNumber = index +1
      const page = await pdf.getPage(index +1)
      return getPageTexts(page, index)
    }
    else {
      return null
    }
  }



  /**
   * Helpers
   */
  async function getPageTexts(page, index) {
    const content = await page.getTextContent()
    const lines = [];
    for (var i=0; i<content.items.length; i++) {
      if (lines.length == 0 || i > 0 && content.items[i-1].transform[5] != content.items[i].transform[5]) lines.push("");
      lines[lines.length-1] += content.items[i].str;
    }
    var texts = lines.map(line => line.trim())
    texts = trimHeaderFooter(texts, index)
    texts = fixParagraphs(texts)
    texts = removeAnnotations(texts)
    return texts
  }

  function removeAnnotations(texts) {
    return texts.map(text => text.replace(/\s*\[[\d,\u2013-]+\]/g, ""))
  }

  function fixParagraphs(texts) {
    var out = [];
    var para = "";
    for (var i=0; i<texts.length; i++) {
      if (!texts[i]) {
        if (para) {
          out.push(para);
          para = "";
        }
        continue;
      }
      if (para) {
        if (/[-\u2013\u2014]$/.test(para)) para = para.substr(0, para.length-1);
        else para += " ";
      }
      para += texts[i].replace(/[-\u2013\u2014]\r?\n/g, "");
      if (texts[i].match(/[.!?:)"'\u2019\u201d]$/)) {
        out.push(para);
        para = "";
      }
    }
    if (para) out.push(para);
    return out;
  }

  const trimHeaderFooter = (function() {
    var prevs = []
    return function(texts, ref) {
      var trim = prevs
        .filter(function(prev) {
          return prev.ref != ref
        })
        .map(function(prev) {
          var head = 0, tail = 0
          while (head < Math.min(prev.texts.length, texts.length) && leven(prev.texts[head], texts[head]) <= 3) head++
          while (tail < Math.min(prev.texts.length, texts.length) && leven(prev.texts[prev.texts.length-1-tail], texts[texts.length-1-tail]) <= 3) tail++
          return {head: head, tail: tail}
        })
        .filter(function(trim) {
          return trim.head || trim.tail
        })
        .reduce(function(biggest, trim) {
          return biggest && (biggest.head + biggest.tail >= trim.head + trim.tail) ? biggest : trim
        }, null)

      if (prevs.every(function(x) {return x.ref != ref})) {
        prevs.push({texts: texts, ref: ref})
        if (prevs.length > 3) prevs.shift()
      }
      return trim ? texts.slice(trim.head, trim.tail ? -trim.tail : undefined) : texts
    }
  })();

  //https://github.com/gustf/js-levenshtein
  const leven = (function()
  {
    function _min(d0, d1, d2, bx, ay)
    {
      return d0 < d1 || d2 < d1
          ? d0 > d2
              ? d2 + 1
              : d0 + 1
          : bx === ay
              ? d1
              : d1 + 1;
    }

    return function(a, b)
    {
      if (a === b) {
        return 0;
      }

      if (a.length > b.length) {
        var tmp = a;
        a = b;
        b = tmp;
      }

      var la = a.length;
      var lb = b.length;

      while (la > 0 && (a.charCodeAt(la - 1) === b.charCodeAt(lb - 1))) {
        la--;
        lb--;
      }

      var offset = 0;

      while (offset < la && (a.charCodeAt(offset) === b.charCodeAt(offset))) {
        offset++;
      }

      la -= offset;
      lb -= offset;

      if (la === 0 || lb < 3) {
        return lb;
      }

      var x = 0;
      var y;
      var d0;
      var d1;
      var d2;
      var d3;
      var dd;
      var dy;
      var ay;
      var bx0;
      var bx1;
      var bx2;
      var bx3;

      var vector = [];

      for (y = 0; y < la; y++) {
        vector.push(y + 1);
        vector.push(a.charCodeAt(offset + y));
      }

      var len = vector.length - 1;

      for (; x < lb - 3;) {
        bx0 = b.charCodeAt(offset + (d0 = x));
        bx1 = b.charCodeAt(offset + (d1 = x + 1));
        bx2 = b.charCodeAt(offset + (d2 = x + 2));
        bx3 = b.charCodeAt(offset + (d3 = x + 3));
        dd = (x += 4);
        for (y = 0; y < len; y += 2) {
          dy = vector[y];
          ay = vector[y + 1];
          d0 = _min(dy, d0, d1, bx0, ay);
          d1 = _min(d0, d1, d2, bx1, ay);
          d2 = _min(d1, d2, d3, bx2, ay);
          dd = _min(d2, d3, dd, bx3, ay);
          vector[y] = dd;
          d3 = d2;
          d2 = d1;
          d1 = d0;
          d0 = dy;
        }
      }

      for (; x < lb;) {
        bx0 = b.charCodeAt(offset + (d0 = x));
        dd = ++x;
        for (y = 0; y < len; y += 2) {
          dy = vector[y];
          vector[y] = dd = _min(dy, d0, dd, bx0, vector[y + 1]);
          d0 = dy;
        }
      }

      return dd;
    };
  })();

  function selectFile() {
    if ($("#ra-upload-dialog").length == 0) {
      const div = $("<div>")
        .attr("id", "ra-upload-dialog");
      $("<div>")
        .text("*PDF files are opened locally and not uploaded to server.")
        .css({color: "red", "font-size": "smaller", "margin": "1em 0 2em 0"})
        .appendTo(div);
      $("<input>")
        .attr("type", "file")
        .attr("name", "fileToUpload")
        .attr("accept", "application/pdf")
        .on("change", function() {
          div.data("result", this.files[0]).dialog("close")
        })
        .appendTo(div);
      div.dialog({
        appendTo: document.body,
        title: "Select PDF file to Read Aloud",
        width: 450,
        autoOpen: false,
      })
    }
    return new Promise(fulfill => {
      $("#ra-upload-dialog")
        .data("result", null)
        .dialog("open")
        .one("dialogclose", function() {
          const file = $(this).data("result")
          fulfill(file && URL.createObjectURL(file))
        })
    })
  }
})();
