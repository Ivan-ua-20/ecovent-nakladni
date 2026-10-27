// ЗГЕНЕРОВАНО: npm run build (src/pages-entry.js). Не редагуйте вручну.

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = (arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
};

// node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = (request) => "headers" in request;
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return parseFormData(request, {
    all,
    dot
  });
  return {};
};
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData) return convertFormDataToBodyData(formData, options);
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]"))) form[key] = value;
    else handleParsingAllValues(form, key, value);
  });
  if (options.dot) Object.entries(form).forEach(([key, value]) => {
    if (key.includes(".")) {
      handleParsingNestedValues(form, key, value, nestingState);
      delete form[key];
    }
  });
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) form[key].push(value);
    else form[key] = [form[key], value];
  } else if (!key.endsWith("[]")) form[key] = value;
  else form[key] = [value];
};
var handleParsingNestedValues = (form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33) throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};
var throwNestingLimitExceeded = () => {
  throw new Error("Nesting limit exceeded");
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") paths.shift();
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
      paths[j] = paths[j].replace(mark, groups[i][1]);
      break;
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
        cacheKey,
        match2[1],
        new RegExp(`^${match2[2]}(?=/${next})`)
      ] : [
        label,
        match2[1],
        new RegExp(`^${match2[2]}$`)
      ];
      else patternCache[cacheKey] = [
        label,
        match2[1],
        true
      ];
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) break;
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") results.push("/");
        else results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var tryDecodeURIComponent = (str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str;
var _decodeURI = (value) => {
  if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
};
var _getQueryParam = (url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) return;
    if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) return "";
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded) name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "") continue;
    let value;
    if (valueIndex === -1) value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
      results[name].push(value);
    } else results[name] ??= value;
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) return cachedBody;
    for (const anyCachedKey in bodyCache) return bodyCache[anyCachedKey].then((body) => {
      if (anyCachedKey === "json") body = JSON.stringify(body);
      const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
      return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
    });
    return bodyCache[key] = raw2[key]();
  };
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) str = str.toString();
    if (str instanceof Promise) str = await str;
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) return Promise.resolve(str);
  if (buffer) buffer[0] += str;
  else buffer = [str];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) return raw(await resStr, callbacks);
  else return resStr;
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req2, options) {
    this.#rawRequest = req2;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
        } else _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = (layout) => this.#layout = layout;
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = () => this.#layout;
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = (name, value, options) => {
    if (this.finalized) this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  };
  status = (status) => {
    this.#status = status;
  };
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var) return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) if (key === "set-cookie") responseHeaders.append(key, value);
      else responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) if (++count > 1 || typeof headers[k] !== "string") {
          responseHeaders = new Headers();
          break;
        }
      }
      if (responseHeaders) for (const k in headers) {
        const v = headers[k];
        if (typeof v === "string") responseHeaders.set(k, v);
        else {
          responseHeaders.delete(k);
          for (const v2 of v) responseHeaders.append(k, v2);
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  };
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = (object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  };
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else handler = i === middleware.length && next || void 0;
      if (handler) try {
        res = await handler(context, () => dispatch(i + 1));
      } catch (err) {
        if (err instanceof Error && onError) {
          context.error = err;
          res = await onError(err, context);
          isError = true;
        } else throw err;
      }
      else if (context.finalized === false && onNotFound) res = await onNotFound(context);
      if (res && (context.finalized === false || isError)) context.res = res;
      return context;
    }
  };
};

// node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class Hono2 {
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") this.#path = args1;
        else this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) this.#addRoute(methodName, this.#path, handler);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute("ALL", this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) handler = r.handler;
      else {
        handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) replaceRequest = (request) => request;
        else replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) return res;
      await next();
    };
    this.#addRoute("ALL", mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  };
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/utils.js
var createNullObject = () => /* @__PURE__ */ Object.create(null);

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch) return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3) return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1) return 1;
  if (a === ".*" || a === "(?:|/.*)") return b === "(?:|/.*)" ? -1 : 1;
  else if (b === ".*" || b === "(?:|/.*)") return -1;
  if (a === "[^/]+") return 1;
  else if (b === "[^/]+") return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class Node2 {
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens2, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens2.length; i < len; i++) {
      const token = tokens2[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ".*"
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (regexpStr === ".*") throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) throw PATH_ERROR;
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ".*" && regexpStr !== "(?:|/.*)") {
            for (const k in node.#children) if ((regexpStr.length > 1 || k.length > 1) && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) if (k.length > 1 && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) throw PATH_ERROR;
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) strList.unshift(`#${this.#index}`);
    if (strList.length === 0) return "";
    if (strList.length === 1) return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) break;
    }
    const tokens2 = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens2.length - 1; j >= 0; j--) if (tokens2[j].indexOf(mark) !== -1) {
        tokens2[j] = tokens2[j].replace(mark, groups[i][1]);
        break;
      }
    }
    this.#root.insert(tokens2, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") return [
      /^$/,
      [],
      []
    ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(`^${path.replace(/\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g, (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ".*" : `/:${LABEL_REG_EXP_STR}`)}$`);
}
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) if (buildWildcardRegExp(k).test(path)) return [...middleware[k]];
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { ["ALL"]: createNullObject() };
    this.#routes = { ["ALL"]: createNullObject() };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap["ALL"]) {
          handlerMap[method][p] = [...handlerMap["ALL"][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*") path = "*";
    const methods = method === "ALL" ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods) if (!middleware[m][path]) {
        this.#insertPath(m, path);
        middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware["ALL"], path) || [];
      }
      for (const handlerMap of [middleware, routes]) for (const m of methods) for (const p in handlerMap[m]) re.test(p) && handlerMap[m][p].push([handler, path]);
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) for (const m of methods) {
      if (!routes[m][path2]) {
        this.#insertPath(m, path2);
        routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware["ALL"], path2) || [];
      }
      routes[m][path2].push([handler, path2]);
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) matchers[method] = this.#buildMatcher(method);
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) for (const path in r) {
      const handlers = r[path];
      const pathData = trie.paths[path];
      if (!pathData) {
        staticMap[path] = [handlers.map(([h6]) => [h6, createNullObject()]), emptyParam];
        continue;
      }
      handlerData[pathData[0]] = handlers.map(([h6, handlerPath]) => [h6, trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
        map[key] = paramReplacementMap[pathData[1][i][1]];
        return map;
      }, createNullObject())]);
    }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler
    ]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) handlerSets.sort((a, b) => {
      return a.score - b.score;
    });
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) this.#node.insert(method, result, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// src/core/auth.js
var ROLES = {
  owner: "\u0412\u043B\u0430\u0441\u043D\u0438\u043A",
  admin: "\u0410\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440",
  admin_lite: "\u0410\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440 (\u0431\u0435\u0437 \u043A\u0435\u0440\u0443\u0432\u0430\u043D\u043D\u044F \u043B\u044E\u0434\u044C\u043C\u0438)",
  manager: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440",
  viewer: "\u041F\u0435\u0440\u0435\u0433\u043B\u044F\u0434",
  partner: "\u041F\u0430\u0440\u0442\u043D\u0435\u0440 (B2B)"
};
var PERMS = {
  owner: ["docs.view", "docs.edit", "refs.edit", "requisites", "api", "users", "people", "analytics", "an.view", "b2b.admin"],
  admin: ["docs.view", "docs.edit", "refs.edit", "requisites", "api", "users", "people", "analytics", "an.view", "b2b.admin"],
  // Як адміністратор, але без керування людьми (аналітику вмикає/вимикає лише власник).
  admin_lite: ["docs.view", "docs.edit", "refs.edit", "requisites", "api", "users", "analytics", "an.view", "b2b.admin"],
  manager: ["docs.view", "docs.edit", "refs.edit", "an.view"],
  viewer: ["docs.view"],
  partner: ["b2b.partner"]
};
var AN_PERMS = ["analytics", "an.view"];
var permsOf = (role) => PERMS[role] || [];
var PARTNER_ROLES = { head: "\u041A\u0435\u0440\u0456\u0432\u043D\u0438\u043A", staff: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440", viewer: "\u041B\u0438\u0448\u0435 \u043F\u0435\u0440\u0435\u0433\u043B\u044F\u0434" };
var partnerRole = (u) => PARTNER_ROLES[u?.partner_role] ? u.partner_role : "head";
function permsOfUser(u) {
  if (!u) return [];
  if (u.role === "partner") {
    const r = partnerRole(u);
    return ["b2b.partner", ...r !== "viewer" ? ["b2b.order"] : [], ...r === "head" ? ["b2b.team"] : []];
  }
  const base = permsOf(u.role);
  if (u.role === "owner" || u.role === "partner" || u.an_access == null || u.an_access === "") return base;
  if (Number(u.an_access) === 0) return base.filter((p) => !AN_PERMS.includes(p));
  return base.includes("an.view") ? base : [...base, "an.view"];
}
var hasAnalytics = (u) => permsOfUser(u).includes("an.view");
var can = (user, perm) => Boolean(user && permsOfUser(user).includes(perm));
var enc = new TextEncoder();
var toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
var fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h6) => parseInt(h6, 16)));
function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}
var ITER = 1e5;
function setIterations(n) {
  if (n >= 1e3) ITER = Math.min(n, 1e5);
}
async function derive(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return toHex(bits);
}
async function hashPassword(password) {
  const salt = fromHex(randomToken(16));
  const h6 = await derive(password, salt, ITER);
  return `pbkdf2$${ITER}$${toHex(salt)}$${h6}`;
}
async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !saltHex || !hashHex) return false;
  const h6 = await derive(password, fromHex(saltHex), Number(iter));
  let diff = h6.length ^ hashHex.length;
  for (let i = 0; i < Math.min(h6.length, hashHex.length); i++) diff |= h6.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
var publicUser = (u) => u ? {
  id: u.id,
  login: u.login,
  name: u.name || u.login,
  role: u.role,
  role_name: ROLES[u.role] || u.role,
  active: u.active,
  created_at: u.created_at,
  perms: permsOfUser(u),
  crm_logins: crmLogins(u.crm_logins),
  analytics: hasAnalytics(u),
  partner_id: u.partner_id || null,
  ...u.role === "partner" ? { partner_role: partnerRole(u), partner_role_name: PARTNER_ROLES[partnerRole(u)] } : {}
} : null;
var crmLogins = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
async function resetOwnerPassword(db, newPassword) {
  const owner = await db.get(`SELECT id, login FROM users WHERE role = 'owner' LIMIT 1`);
  if (!owner) return null;
  await db.run(`UPDATE users SET password_hash = ?, active = 1 WHERE id = ?`, [await hashPassword(newPassword), owner.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [owner.id]);
  return owner.login;
}

// src/core/common.js
var MASK = "\u2022\u2022\u2022\u2022\u2022\u2022";
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var fail = (status, message) => Object.assign(new Error(message), { status });
var need = (c, perm) => {
  if (!can(c.get("user"), perm)) throw fail(403, "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u0446\u0456\u0454\u0457 \u0434\u0456\u0457.");
};
var userName = (c) => c.get("user")?.name || c.get("user")?.login || "";
var loadSettings = async (db) => Object.fromEntries((await db.all(`SELECT key, value FROM settings`)).map((r) => [r.key, r.value]));
var putSetting = (db, key, value) => db.run(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  [key, String(value)]
);
var round2 = (n) => Math.round(n * 100) / 100;
var num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
var kyivDay = (d = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(d);
var parseTpl = (t) => t ? { ...t, options: JSON.parse(t.options || "{}") } : null;
var hash = (s) => {
  let h6 = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h6 ^= s.charCodeAt(i);
    h6 = Math.imul(h6, 16777619) >>> 0;
  }
  return h6.toString(16);
};

// node_modules/hono/dist/utils/cookie.js
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var relaxedCookieNameRegEx = /^[!#-:<>-[\]-~]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var trimCookieWhitespace = (value) => {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const charCode = value.charCodeAt(start);
    if (charCode !== 32 && charCode !== 9) break;
    start++;
  }
  while (end > start) {
    const charCode = value.charCodeAt(end - 1);
    if (charCode !== 32 && charCode !== 9) break;
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
};
var parse = (cookie, name) => {
  if (name && cookie.indexOf(name) === -1) return {};
  const pairs = cookie.split(";");
  const parsedCookie = /* @__PURE__ */ Object.create(null);
  for (const pairStr of pairs) {
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) continue;
    const cookieName = trimCookieWhitespace(pairStr.substring(0, valueStartPos));
    if (name && name !== cookieName || !relaxedCookieNameRegEx.test(cookieName) || cookieName in parsedCookie) continue;
    let cookieValue = trimCookieWhitespace(pairStr.substring(valueStartPos + 1));
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) cookieValue = cookieValue.slice(1, -1);
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = tryDecodeURIComponent(cookieValue);
      if (name) break;
    }
  }
  return parsedCookie;
};
var _serialize = (name, value, opt = {}) => {
  if (!validCookieNameRegEx.test(name)) throw new Error("Invalid cookie name");
  let cookie = `${name}=${value}`;
  if (name.startsWith("__Secure-") && !opt.secure) throw new Error("__Secure- Cookie must have Secure attributes");
  if (name.startsWith("__Host-")) {
    if (!opt.secure) throw new Error("__Host- Cookie must have Secure attributes");
    if (opt.path !== "/") throw new Error('__Host- Cookie must have Path attributes with "/"');
    if (opt.domain) throw new Error("__Host- Cookie must not have Domain attributes");
  }
  for (const key of [
    "domain",
    "path",
    "sameSite",
    "priority"
  ]) if (opt[key] && /[;\r\n]/.test(opt[key])) throw new Error(`${key} must not contain ";", "\\r", or "\\n"`);
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) throw new Error("Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.");
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") cookie += `; Domain=${opt.domain}`;
  if (opt.path) cookie += `; Path=${opt.path}`;
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) throw new Error("Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.");
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) cookie += "; HttpOnly";
  if (opt.secure) cookie += "; Secure";
  if (opt.sameSite) cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  if (opt.priority) cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  if (opt.partitioned) {
    if (!opt.secure) throw new Error("Partitioned Cookie must have Secure attributes");
    cookie += "; Partitioned";
  }
  return cookie;
};
var serialize = (name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
};

// node_modules/hono/dist/helper/cookie/index.js
var getCookie = (c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie) return;
    let finalKey = key;
    if (prefix === "secure") finalKey = "__Secure-" + key;
    else if (prefix === "host") finalKey = "__Host-" + key;
    return parse(cookie, finalKey)[finalKey];
  }
  if (!cookie) return {};
  return parse(cookie);
};
var generateCookie = (name, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure") cookie = serialize("__Secure-" + name, value, {
    path: "/",
    ...opt,
    secure: true
  });
  else if (opt?.prefix === "host") cookie = serialize("__Host-" + name, value, {
    ...opt,
    path: "/",
    secure: true,
    domain: void 0
  });
  else cookie = serialize(name, value, {
    path: "/",
    ...opt
  });
  return cookie;
};
var setCookie = (c, name, value, opt) => {
  const cookie = generateCookie(name, value, opt);
  c.header("Set-Cookie", cookie, { append: true });
};
var deleteCookie = (c, name, opt) => {
  const deletedCookie = getCookie(c, name, opt?.prefix);
  setCookie(c, name, "", {
    ...opt,
    maxAge: 0
  });
  return deletedCookie;
};

// src/modules/auth/index.js
function mountAuth(app, { db, runCleanup, onCleanup }) {
  onCleanup(() => db.run(`DELETE FROM sessions WHERE created_at < ?`, [new Date(Date.now() - 90 * 864e5).toISOString()]));
  const COOKIE = "nk_sid";
  async function sessionUser(c) {
    const token = getCookie(c, COOKIE);
    if (!token) return null;
    const u = await db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`,
      [token]
    );
    return u || null;
  }
  async function startSession(c, user) {
    const token = randomToken();
    await db.run(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`, [token, user.id, nowIso()]);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 90 * 86400, secure: new URL(c.req.url).protocol === "https:" });
  }
  app.get("/api/auth/state", async (c) => {
    const n = await db.get(`SELECT COUNT(*) AS n FROM users`);
    if (!n?.n) return c.json({ needsSetup: true, user: null });
    return c.json({ needsSetup: false, user: publicUser(await sessionUser(c)) });
  });
  app.post("/api/auth/setup", async (c) => {
    const n = await db.get(`SELECT COUNT(*) AS n FROM users`);
    if (n?.n) throw fail(400, "\u0412\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u0432\u0436\u0435 \u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E.");
    const b = await c.req.json();
    const login = String(b.login || "").trim().toLowerCase();
    if (!login || String(b.password || "").length < 6) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043B\u043E\u0433\u0456\u043D \u0456 \u043F\u0430\u0440\u043E\u043B\u044C (\u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432).");
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at) VALUES (?, ?, ?, 'owner', 1, ?)`, [
      login,
      String(b.name || "").trim(),
      await hashPassword(b.password),
      nowIso()
    ]);
    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [r.lastId]);
    await startSession(c, user);
    return c.json({ user: publicUser(user) });
  });
  app.post("/api/auth/login", async (c) => {
    const b = await c.req.json();
    const user = await db.get(`SELECT * FROM users WHERE login = ?`, [String(b.login || "").trim().toLowerCase()]);
    if (user?.locked_until && user.locked_until > nowIso()) {
      const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 6e4));
      throw fail(429, `\u0417\u0430\u0431\u0430\u0433\u0430\u0442\u043E \u043D\u0435\u0432\u0434\u0430\u043B\u0438\u0445 \u0441\u043F\u0440\u043E\u0431. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 ${mins} \u0445\u0432.`);
    }
    if (!user || !user.active || !await verifyPassword(String(b.password || ""), user.password_hash)) {
      if (user) {
        const n = (Number(user.failed_logins) || 0) + 1;
        const lock = n >= 5 ? new Date(Date.now() + 5 * 6e4).toISOString() : "";
        await db.run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`, [lock ? 0 : n, lock, user.id]);
      }
      throw fail(401, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043B\u043E\u0433\u0456\u043D \u0430\u0431\u043E \u043F\u0430\u0440\u043E\u043B\u044C.");
    }
    if (user.failed_logins || user.locked_until) await db.run(`UPDATE users SET failed_logins = 0, locked_until = '' WHERE id = ?`, [user.id]);
    await startSession(c, user);
    return c.json({ user: publicUser(user) });
  });
  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  const PARTNER_PATHS = ["/api/b2b/p", "/api/me/password", "/api/tg/me", "/api/tg/link", "/api/bootstrap"];
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/odb/hook" || c.req.path === "/api/tg/hook" || c.req.path.startsWith("/api/cron/")) return next();
    const user = await sessionUser(c);
    if (!user) throw fail(401, "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u043E \u0443\u0432\u0456\u0439\u0442\u0438.");
    c.set("user", user);
    if (user.role === "partner" && !PARTNER_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
      throw fail(403, "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u0446\u0456\u0454\u0457 \u0434\u0456\u0457.");
    }
    await runCleanup(c);
    return next();
  });
  app.put("/api/me/password", async (c) => {
    const b = await c.req.json();
    const me = c.get("user");
    if (!await verifyPassword(String(b.old || ""), me.password_hash)) throw fail(400, "\u041F\u043E\u0442\u043E\u0447\u043D\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u043D\u0435\u0432\u0456\u0440\u043D\u0438\u0439.");
    if (String(b.password || "").length < 6) throw fail(400, "\u041D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(b.password), me.id]);
    return c.json({ ok: true });
  });
  const ASSIGNABLE = ["admin", "admin_lite", "manager", "viewer"];
  app.get("/api/users", async (c) => {
    need(c, "people");
    const rows = await db.all(`SELECT * FROM users WHERE role != 'partner' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'admin_lite' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END, login`);
    return c.json({ users: rows.map(publicUser), roles: ROLES });
  });
  app.post("/api/users", async (c) => {
    need(c, "people");
    const b = await c.req.json();
    const login = String(b.login || "").trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw fail(400, "\u041B\u043E\u0433\u0456\u043D: \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438, \u043A\u0440\u0430\u043F\u043A\u0430, \u0434\u0435\u0444\u0456\u0441 (2\u201340 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432).");
    if (!ASSIGNABLE.includes(b.role)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0440\u043E\u043B\u044C.");
    if (String(b.password || "").length < 6) throw fail(400, "\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
    if (await db.get(`SELECT id FROM users WHERE login = ?`, [login])) throw fail(400, "\u0422\u0430\u043A\u0438\u0439 \u043B\u043E\u0433\u0456\u043D \u0443\u0436\u0435 \u0454.");
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at, crm_logins) VALUES (?, ?, ?, ?, 1, ?, ?)`, [
      login,
      String(b.name || "").trim(),
      await hashPassword(b.password),
      b.role,
      nowIso(),
      crmLogins(b.crm_logins).join(",")
    ]);
    return c.json({ id: r.lastId });
  });
  app.put("/api/users/:id", async (c) => {
    need(c, "people");
    const me = c.get("user");
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param("id")]);
    if (!target) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (target.role === "owner" && me.role !== "owner") throw fail(403, "\u0410\u043A\u0430\u0443\u043D\u0442 \u0432\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u043C\u043E\u0436\u0435 \u0437\u043C\u0456\u043D\u044E\u0432\u0430\u0442\u0438 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
    if (target.role === "partner") throw fail(400, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0456 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0456\u0432 \u0437\u043C\u0456\u043D\u044E\u044E\u0442\u044C\u0441\u044F \u0432 \u0440\u043E\u0437\u0434\u0456\u043B\u0456 \xABB2B \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0438\xBB.");
    const b = await c.req.json();
    if (b.analytics !== void 0) {
      if (me.role !== "owner") throw fail(403, "\u0414\u043E\u0441\u0442\u0443\u043F \u0434\u043E \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0438 \u0437\u043C\u0456\u043D\u044E\u0454 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
      if (target.role !== "owner") {
        await db.run(`UPDATE users SET an_access = ? WHERE id = ?`, [b.analytics ? 1 : 0, target.id]);
        await db.run(
          `INSERT INTO audit_log (at, user_id, user_name, kind, ref_id, action, changes) VALUES (?, ?, ?, 'user', ?, ?, '[]')`,
          [nowIso(), me.id, me.name || me.login, String(target.id), `\u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430 ${b.analytics ? "\u0443\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u0430" : "\u0432\u0438\u043C\u043A\u043D\u0435\u043D\u0430"} \u0434\u043B\u044F ${target.login}`]
        );
      }
    }
    const sets = [];
    const vals = [];
    if (b.name !== void 0) {
      sets.push("name = ?");
      vals.push(String(b.name).trim());
    }
    if (b.crm_logins !== void 0) {
      sets.push("crm_logins = ?");
      vals.push(crmLogins(b.crm_logins).join(","));
    }
    if (b.role !== void 0 && target.role !== "owner") {
      if (!ASSIGNABLE.includes(b.role)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0440\u043E\u043B\u044C.");
      sets.push("role = ?");
      vals.push(b.role);
    }
    if (b.active !== void 0 && target.role !== "owner") {
      if (String(target.id) === String(me.id)) throw fail(400, "\u041D\u0435 \u043C\u043E\u0436\u043D\u0430 \u0432\u0438\u043C\u043A\u043D\u0443\u0442\u0438 \u0432\u043B\u0430\u0441\u043D\u0438\u0439 \u0430\u043A\u0430\u0443\u043D\u0442.");
      sets.push("active = ?");
      vals.push(b.active ? 1 : 0);
    }
    if (b.password) {
      if (String(b.password).length < 6) throw fail(400, "\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
      sets.push("password_hash = ?");
      vals.push(await hashPassword(b.password));
    }
    if (sets.length) await db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, target.id]);
    if (b.password || b.active === false || b.active === 0 || b.role !== void 0) {
      await db.run(`DELETE FROM sessions WHERE user_id = ? AND user_id != ?`, [target.id, me.id]);
    }
    return c.json({ ok: true });
  });
  app.post("/api/users/transfer-owner", async (c) => {
    const me = c.get("user");
    if (me.role !== "owner") throw fail(403, "\u041F\u0435\u0440\u0435\u0434\u0430\u0442\u0438 \u043F\u0440\u0430\u0432\u0430 \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
    const b = await c.req.json();
    if (!await verifyPassword(String(b.password || ""), me.password_hash)) throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C.");
    if (!ASSIGNABLE.includes(b.myRole)) throw fail(400, "\u0412\u0438\u0431\u0435\u0440\u0456\u0442\u044C \u0441\u0432\u043E\u044E \u043D\u043E\u0432\u0443 \u0440\u043E\u043B\u044C.");
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [b.userId]);
    if (!target || String(target.id) === String(me.id)) throw fail(400, "\u0412\u0438\u0431\u0435\u0440\u0456\u0442\u044C \u0456\u043D\u0448\u043E\u0433\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430.");
    if (!target.active) throw fail(400, "\u0426\u0435\u0439 \u0430\u043A\u0430\u0443\u043D\u0442 \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0443\u0432\u0456\u043C\u043A\u043D\u0456\u0442\u044C \u0439\u043E\u0433\u043E.");
    await db.batch([
      [`UPDATE users SET role = 'owner' WHERE id = ?`, [target.id]],
      [`UPDATE users SET role = ? WHERE id = ?`, [b.myRole, me.id]]
    ]);
    return c.json({ ok: true });
  });
  app.delete("/api/users/:id", async (c) => {
    need(c, "people");
    const me = c.get("user");
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param("id")]);
    if (!target) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (target.role === "owner") throw fail(403, "\u0410\u043A\u0430\u0443\u043D\u0442 \u0432\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u0432\u0438\u0434\u0430\u043B\u0438\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430.");
    if (String(target.id) === String(me.id)) throw fail(400, "\u041D\u0435 \u043C\u043E\u0436\u043D\u0430 \u0432\u0438\u0434\u0430\u043B\u0438\u0442\u0438 \u0432\u043B\u0430\u0441\u043D\u0438\u0439 \u0430\u043A\u0430\u0443\u043D\u0442.");
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
    await db.run(`DELETE FROM users WHERE id = ?`, [target.id]);
    return c.json({ ok: true });
  });
}

// src/core/schema.js
var schema = {
  name: "core",
  version: 1,
  tables: [
    `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`
  ],
  columns: [],
  // Строк зберігання — спільний для чистки всіх модулів.
  async seed(db) {
    await db.run(`INSERT INTO settings (key, value) VALUES ('retention_days', '7') ON CONFLICT(key) DO NOTHING`);
  }
};
var DEFAULT_WARNING = "\u0423\u0432\u0430\u0433\u0430! \u041E\u043F\u043B\u0430\u0442\u0430 \u0446\u044C\u043E\u0433\u043E \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u043E\u0437\u043D\u0430\u0447\u0430\u0454 \u043F\u043E\u0433\u043E\u0434\u0436\u0435\u043D\u043D\u044F \u0437 \u0443\u043C\u043E\u0432\u0430\u043C\u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u0456\u0432. \u041F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F \u043F\u0440\u043E \u043E\u043F\u043B\u0430\u0442\u0443 \u0454 \u043E\u0431\u043E\u0432'\u044F\u0437\u043A\u043E\u0432\u0438\u043C, \u0432 \u0456\u043D\u0448\u043E\u043C\u0443 \u0432\u0438\u043F\u0430\u0434\u043A\u0443 \u043D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0443\u0454\u0442\u044C\u0441\u044F \u043D\u0430\u044F\u0432\u043D\u0456\u0441\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u0456\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0456. \u0422\u043E\u0432\u0430\u0440 \u0432\u0456\u0434\u043F\u0443\u0441\u043A\u0430\u0454\u0442\u044C\u0441\u044F \u0437\u0430 \u0444\u0430\u043A\u0442\u043E\u043C \u043D\u0430\u0434\u0445\u043E\u0434\u0436\u0435\u043D\u043D\u044F \u043A\u043E\u0448\u0442\u0456\u0432 \u043D\u0430 \u043F/\u0440 \u041F\u043E\u0441\u0442\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A\u0430, \u0441\u0430\u043C\u043E\u0432\u0438\u0432\u043E\u0437\u043E\u043C, \u0437\u0430 \u043D\u0430\u044F\u0432\u043D\u043E\u0441\u0442\u0456 \u0434\u043E\u0432\u0456\u0440\u0435\u043D\u043E\u0441\u0442\u0456 \u0442\u0430 \u043F\u0430\u0441\u043F\u043E\u0440\u0442\u0430.";

// src/core/validate.js
var IMAGE_FIELDS = ["logo", "signature", "stamp"];
var MAX_IMAGE_CHARS = 3e6;
var IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
var isSafeImage = (v) => {
  const s = String(v ?? "");
  return s === "" || s.length <= MAX_IMAGE_CHARS && IMAGE_RE.test(s);
};
function checkImages(body, fail2) {
  for (const k of IMAGE_FIELDS) {
    if (body[k] !== void 0 && !isSafeImage(body[k])) {
      throw fail2(400, `\u041F\u043E\u043B\u0435 \xAB${k}\xBB: \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u0430 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0430 PNG, JPEG, WebP \u0430\u0431\u043E GIF (\u0434\u043E 2 \u041C\u0411).`);
    }
  }
}
function dropUnsafeImages(row) {
  const out = { ...row };
  for (const k of IMAGE_FIELDS) if (k in out && !isSafeImage(out[k])) out[k] = "";
  return out;
}

// src/core/requisites.js
var FOP_REQUISITES = ["short_name", "full_name", "ipn", "address", "iban", "bank", "phone", "email", "extra", "logo", "signature", "stamp"];
var INV_FOP_REQUISITES = ["short_name", "full_name", "ipn", "iban", "bank", "address", "phone", "warning_text", "signature", "stamp"];
var IMAGES = /* @__PURE__ */ new Set(["logo", "signature", "stamp"]);
var REQUISITES_DENIED = "\u0420\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0438 \u0424\u041E\u041F (IBAN, \u0406\u041F\u041D, \u043D\u0430\u0437\u0432\u0443, \u0430\u0434\u0440\u0435\u0441\u0443, \u043F\u0456\u0434\u043F\u0438\u0441, \u043F\u0435\u0447\u0430\u0442\u043A\u0443) \u0437\u043C\u0456\u043D\u044E\u044E\u0442\u044C \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A \u0456 \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0438.";
function changedFields(current, body, fields) {
  return fields.filter((k) => body[k] !== void 0 && String(body[k] ?? "") !== String(current?.[k] ?? ""));
}
function describeChanges(current, body, fields) {
  return fields.map((k) => IMAGES.has(k) ? { field: k, from: current?.[k] ? "\u0454" : "\u043D\u0435\u043C\u0430\u0454", to: body[k] ? "\u043D\u043E\u0432\u0435 \u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u043D\u044F" : "\u043F\u0440\u0438\u0431\u0440\u0430\u043D\u043E" } : { field: k, from: String(current?.[k] ?? ""), to: String(body[k] ?? "") });
}
async function logAudit(db, { user, kind, refId = "", action, changes = [] }) {
  await db.run(
    `INSERT INTO audit_log (at, user_id, user_name, kind, ref_id, action, changes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [(/* @__PURE__ */ new Date()).toISOString(), user?.id || null, user?.name || user?.login || "", kind, String(refId), action, JSON.stringify(changes)]
  );
}

// src/integrations/checkbox.js
var BASE = "https://api.checkbox.ua/api/v1";
var CLIENT = { "X-Client-Name": "nakladni-local", "X-Client-Version": "0.1" };
var tokens = /* @__PURE__ */ new Map();
async function req(fetchFn, path, { method = "GET", token, license, body } = {}) {
  const headers = { ...CLIENT, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (license) headers["X-License-Key"] = license;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetchFn(BASE + path, { method, headers, body: body ? JSON.stringify(body) : void 0 });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
  }
  if (!res.ok) {
    const msg = json?.message || json?.detail || text.slice(0, 200);
    const err = new Error(`Checkbox ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}
var hasCheckbox = (fop) => Boolean(fop.checkbox_login && fop.checkbox_password || fop.checkbox_license && fop.checkbox_pin);
async function signIn(fetchFn, fop, force = false) {
  if (!force && tokens.has(fop.id)) return tokens.get(fop.id);
  let json;
  if (fop.checkbox_login && fop.checkbox_password) {
    json = await req(fetchFn, "/cashier/signin", {
      method: "POST",
      body: { login: fop.checkbox_login, password: fop.checkbox_password }
    });
  } else {
    json = await req(fetchFn, "/cashier/signinPinCode", {
      method: "POST",
      license: fop.checkbox_license,
      body: { pin_code: fop.checkbox_pin }
    });
  }
  const token = json?.access_token;
  if (!token) throw new Error("Checkbox \u043D\u0435 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u0442\u043E\u043A\u0435\u043D \u0434\u043E\u0441\u0442\u0443\u043F\u0443");
  tokens.set(fop.id, token);
  return token;
}
async function authed(fetchFn, fop, path, opts = {}) {
  let token = await signIn(fetchFn, fop);
  try {
    return await req(fetchFn, path, { ...opts, token, license: fop.checkbox_license || void 0 });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      token = await signIn(fetchFn, fop, true);
      return req(fetchFn, path, { ...opts, token, license: fop.checkbox_license || void 0 });
    }
    throw e;
  }
}
var parseDate = (s) => {
  if (!s) return /* @__PURE__ */ new Date();
  const d = new Date(String(s).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
};
function summarize(receipt, fop, how) {
  return {
    fopId: fop.id,
    fopName: fop.short_name,
    receiptId: receipt.id,
    fiscalCode: receipt.fiscal_code || "",
    date: receipt.fiscal_date || receipt.created_at || "",
    total: receipt.total_sum != null ? receipt.total_sum / 100 : null,
    url: receipt.id ? `https://check.checkbox.ua/${receipt.id}` : "",
    match: how
    // 'order' | 'sum' | 'manual'
  };
}
async function findReceiptByRef(fetchFn, fops, ref) {
  const clean = String(ref).trim();
  const uuid = clean.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const errors = [];
  for (const fop of fops.filter(hasCheckbox)) {
    try {
      if (uuid) {
        const r = await authed(fetchFn, fop, `/receipts/${uuid}`);
        if (r?.id) return { receipt: summarize(r, fop, "manual"), errors };
      } else {
        const r = await authed(fetchFn, fop, `/receipts/search?fiscal_code=${encodeURIComponent(clean)}&limit=5`);
        const hit = (r?.results || [])[0];
        if (hit) return { receipt: summarize(hit, fop, "manual"), errors };
      }
    } catch (e) {
      if (e.status !== 404) errors.push(`${fop.short_name}: ${e.message}`);
    }
  }
  return { receipt: null, errors };
}
async function findReceiptForOrder(fetchFn, fops, order2, { days = 7 } = {}) {
  const errors = [];
  const from = parseDate(order2.date);
  from.setDate(from.getDate() - 1);
  const to = new Date(from);
  to.setDate(to.getDate() + Number(days) + 1);
  const orderNo2 = String(order2.orderId);
  const orderNoRe = new RegExp(`(^|\\D)${orderNo2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`);
  const sumMatches = [];
  for (const fop of fops.filter(hasCheckbox)) {
    try {
      let offset = 0;
      for (let page = 0; page < 10; page++) {
        const qs = new URLSearchParams({
          from_date: from.toISOString(),
          to_date: to.toISOString(),
          limit: "100",
          offset: String(offset),
          self_receipts: "false"
        });
        const r = await authed(fetchFn, fop, `/receipts/search?${qs}`);
        const results = r?.results || [];
        for (const rc of results) {
          const text = [
            rc.header,
            rc.footer,
            rc.barcode,
            rc.order_id,
            rc.external_id,
            ...(rc.goods || []).map((g) => `${g.good?.code || ""} ${g.good?.name || ""}`)
          ].filter(Boolean).join(" ");
          if (orderNoRe.test(text)) return { receipt: summarize(rc, fop, "order"), errors };
          if (rc.type !== "RETURN" && rc.total_sum != null && Math.abs(rc.total_sum / 100 - order2.total) < 0.01) {
            sumMatches.push(summarize(rc, fop, "sum"));
          }
        }
        if (results.length < 100) break;
        offset += 100;
      }
    } catch (e) {
      errors.push(`${fop.short_name}: ${e.message}`);
    }
  }
  if (sumMatches.length === 1) return { receipt: sumMatches[0], errors };
  if (sumMatches.length > 1) {
    errors.push(`\u0417\u043D\u0430\u0439\u0434\u0435\u043D\u043E ${sumMatches.length} \u0447\u0435\u043A\u0438(\u0456\u0432) \u043D\u0430 \u0441\u0443\u043C\u0443 ${order2.total} \u0433\u0440\u043D \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0424\u041E\u041F \u0432\u0440\u0443\u0447\u043D\u0443 \u0430\u0431\u043E \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u0447\u0435\u043A.`);
  }
  return { receipt: null, errors, candidates: sumMatches };
}
async function testCheckbox(fetchFn, fop) {
  tokens.delete(fop.id);
  const me = await authed(fetchFn, fop, "/cashier/me");
  return { cashier: me?.full_name || "", organization: me?.organization?.title || "" };
}

// src/modules/refs/index.js
var SECRET_FOP_FIELDS = ["checkbox_password", "checkbox_pin", "checkbox_license"];
var FOP_FIELDS = [
  "short_name",
  "full_name",
  "ipn",
  "address",
  "iban",
  "bank",
  "phone",
  "email",
  "extra",
  "template_id",
  "logo",
  "signature",
  "stamp",
  "checkbox_login",
  "checkbox_password",
  "checkbox_license",
  "checkbox_pin",
  "active"
];
var publicFop = (f) => {
  if (!f) return null;
  const out = { ...f };
  for (const k of SECRET_FOP_FIELDS) out[k] = f[k] ? MASK : "";
  out.has_checkbox = hasCheckbox(f);
  return out;
};
function mountRefs(app, { db, fetchFn }) {
  const settings = () => loadSettings(db);
  app.get("/api/bootstrap", async (c) => {
    const user = c.get("user");
    if (user.role === "partner") {
      return c.json({ fops: [], templates: [], offices: [], channels: [], invFops: [], settings: {}, user: publicUser(user) });
    }
    const s = await settings();
    const apiOk = can(user, "api");
    const fops = (await db.all(`SELECT * FROM fops ORDER BY active DESC, short_name`)).map(publicFop).map((f) => {
      if (apiOk) return f;
      const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
      return rest;
    });
    const invFops = await db.all(`SELECT * FROM inv_fops ORDER BY active DESC, short_name`);
    const templates = (await db.all(`SELECT * FROM templates ORDER BY id`)).map(parseTpl);
    const offices = await db.all(`SELECT * FROM offices ORDER BY CAST(office_id AS INTEGER)`);
    const channels = await db.all(`SELECT * FROM channels ORDER BY name`);
    return c.json({
      fops,
      templates,
      offices,
      channels,
      invFops,
      defaultWarning: DEFAULT_WARNING,
      user: publicUser(user),
      settings: apiOk ? { ...s, lpcrm_key: s.lpcrm_key ? MASK : "", lpcrm_in_key: s.lpcrm_in_key ? MASK : "", odb_key: s.odb_key ? MASK : "", tg_token: s.tg_token ? MASK : "", tg_secret: "" } : Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith("lpcrm_") && !k.startsWith("checkbox_") && !k.startsWith("odb_") && !k.startsWith("tg_")).concat([["lpcrm_key", s.lpcrm_key ? MASK : ""], ["lpcrm_subdomain", s.lpcrm_subdomain || ""]]))
    });
  });
  app.put("/api/settings", async (c) => {
    need(c, "refs.edit");
    const body = await c.req.json();
    const apiKeys = ["lpcrm_subdomain", "lpcrm_key", "lpcrm_search_days", "checkbox_enabled", "checkbox_search_days", "odb_key", "odb_name"];
    const general = ["invoice_date_mode", "default_fop_id", "seller_note", "retention_days", "rahunok_next_number"];
    const allowed = can(c.get("user"), "api") ? [...apiKeys, ...general] : general;
    if (body.rahunok_next_number !== void 0 && !/^\d{1,12}$/.test(String(body.rahunok_next_number).trim())) throw fail(400, "\u041D\u043E\u043C\u0435\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u2014 \u043B\u0438\u0448\u0435 \u0446\u0438\u0444\u0440\u0438.");
    if (body.retention_days !== void 0 && !(Number(body.retention_days) >= 1)) throw fail(400, "\u0421\u0442\u0440\u043E\u043A \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u043D\u043D\u044F \u2014 \u0449\u043E\u043D\u0430\u0439\u043C\u0435\u043D\u0448\u0435 1 \u0434\u0435\u043D\u044C.");
    if (body.lpcrm_subdomain !== void 0 && !/^[a-z0-9-]{1,63}$/i.test(String(body.lpcrm_subdomain).trim())) throw fail(400, "\u041F\u0456\u0434\u0434\u043E\u043C\u0435\u043D LP-CRM \u2014 \u043B\u0438\u0448\u0435 \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438 \u0439 \u0434\u0435\u0444\u0456\u0441.");
    for (const k of allowed) {
      if (body[k] === void 0 || body[k] === MASK) continue;
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
        k,
        String(body[k]).trim()
      ]);
    }
    return c.json({ ok: true });
  });
  const fopCols = (c, b) => FOP_FIELDS.filter((k) => b[k] !== void 0 && b[k] !== MASK && (can(c.get("user"), "api") || !k.startsWith("checkbox_")));
  app.post("/api/fops", async (c) => {
    need(c, "refs.edit");
    if (!can(c.get("user"), "requisites")) throw fail(403, REQUISITES_DENIED);
    const b = await c.req.json();
    if (!b.short_name) return c.json({ error: "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0440\u043E\u0442\u043A\u0443 \u043D\u0430\u0437\u0432\u0443 \u0424\u041E\u041F" }, 400);
    checkImages(b, fail);
    const cols = fopCols(c, b);
    const r = await db.run(
      `INSERT INTO fops (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => b[k])
    );
    const fields = changedFields({}, b, FOP_REQUISITES);
    await logAudit(db, { user: c.get("user"), kind: "fop", refId: r.lastId, action: "\u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E", changes: describeChanges({}, b, fields) });
    return c.json({ id: r.lastId });
  });
  app.put("/api/fops/:id", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    checkImages(b, fail);
    const cur = await db.get(`SELECT * FROM fops WHERE id = ?`, [c.req.param("id")]);
    if (!cur) throw fail(404, "\u0424\u041E\u041F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const req2 = changedFields(cur, b, FOP_REQUISITES);
    if (req2.length && !can(c.get("user"), "requisites")) throw fail(403, REQUISITES_DENIED);
    const cols = fopCols(c, b);
    if (!cols.length) return c.json({ ok: true });
    await db.run(`UPDATE fops SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [
      ...cols.map((k) => b[k]),
      cur.id
    ]);
    if (req2.length) await logAudit(db, { user: c.get("user"), kind: "fop", refId: cur.id, action: "\u0437\u043C\u0456\u043D\u0435\u043D\u043E \u0440\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0438", changes: describeChanges(cur, b, req2) });
    return c.json({ ok: true });
  });
  app.delete("/api/fops/:id", async (c) => {
    need(c, "refs.edit");
    await db.run(`UPDATE fops SET active = 0 WHERE id = ?`, [c.req.param("id")]);
    return c.json({ ok: true });
  });
  app.post("/api/fops/:id/checkbox-test", async (c) => {
    need(c, "api");
    const fop = await db.get(`SELECT * FROM fops WHERE id = ?`, [c.req.param("id")]);
    if (!fop) return c.json({ error: "\u0424\u041E\u041F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E" }, 404);
    if (!hasCheckbox(fop)) return c.json({ error: "\u041D\u0435 \u0432\u043A\u0430\u0437\u0430\u043D\u043E \u0434\u043E\u0441\u0442\u0443\u043F \u0434\u043E Checkbox" }, 400);
    return c.json(await testCheckbox(fetchFn, fop));
  });
  app.put("/api/offices", async (c) => {
    need(c, "refs.edit");
    const list = await c.req.json();
    await db.batch((Array.isArray(list) ? list : []).filter((o) => o.office_id).map((o) => [
      `INSERT INTO offices (office_id, name, fop_id, seller_text) VALUES (?, ?, ?, ?)
       ON CONFLICT(office_id) DO UPDATE SET name = excluded.name, fop_id = excluded.fop_id, seller_text = excluded.seller_text`,
      [String(o.office_id).trim(), o.name || "", o.fop_id || null, String(o.seller_text || "").trim()]
    ]));
    return c.json({ ok: true });
  });
  app.put("/api/channels", async (c) => {
    need(c, "refs.edit");
    const list = await c.req.json();
    const st = [[`DELETE FROM channels`, []]];
    for (const ch of Array.isArray(list) ? list : []) {
      const name = String(ch.name || "").trim();
      if (!name) continue;
      st.push([`INSERT INTO channels (name, fop_id, seller_text) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fop_id = excluded.fop_id, seller_text = excluded.seller_text`, [name, ch.fop_id || null, String(ch.seller_text || "").trim()]]);
    }
    await db.batch(st);
    return c.json({ ok: true });
  });
  app.delete("/api/offices/:id", async (c) => {
    need(c, "refs.edit");
    await db.run(`DELETE FROM offices WHERE office_id = ?`, [c.req.param("id")]);
    return c.json({ ok: true });
  });
  app.post("/api/templates", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    const r = await db.run(`INSERT INTO templates (name, layout, options) VALUES (?, ?, ?)`, [
      b.name || "\u041D\u043E\u0432\u0438\u0439 \u0448\u0430\u0431\u043B\u043E\u043D",
      b.layout || "classic",
      JSON.stringify(b.options || {})
    ]);
    return c.json({ id: r.lastId });
  });
  app.put("/api/templates/:id", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    await db.run(`UPDATE templates SET name = ?, layout = ?, options = ? WHERE id = ?`, [
      b.name,
      b.layout,
      JSON.stringify(b.options || {}),
      c.req.param("id")
    ]);
    return c.json({ ok: true });
  });
  app.delete("/api/templates/:id", async (c) => {
    need(c, "refs.edit");
    const id = c.req.param("id");
    const used = await db.get(`SELECT COUNT(*) AS n FROM fops WHERE template_id = ? AND active = 1`, [id]);
    if (used?.n) return c.json({ error: "\u0428\u0430\u0431\u043B\u043E\u043D \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u043E\u0432\u0443\u0454\u0442\u044C\u0441\u044F \u0424\u041E\u041F\u0430\u043C\u0438 \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0437\u043C\u0456\u043D\u0456\u0442\u044C \u0457\u043C \u0448\u0430\u0431\u043B\u043E\u043D" }, 400);
    await db.run(`DELETE FROM templates WHERE id = ?`, [id]);
    return c.json({ ok: true });
  });
}

// src/integrations/lpcrm.js
var MIN_GAP_MS = 1500;
var RETRY_DELAYS_MS = [3e3, 6e3, 12e3];
var queue = Promise.resolve();
var lastAt = 0;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastAt = Date.now();
    }
  });
  queue = run.catch(() => {
  });
  return run;
}
async function call(fetchFn, subdomain, key, method, params, { sleepFn = sleep } = {}) {
  const body = new URLSearchParams({ key, ...params }).toString();
  const doFetch = (url) => throttled(() => fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }));
  let res;
  try {
    res = await doFetch(`https://${subdomain}.lp-crm.biz/api/${method}.html`);
  } catch (e) {
    if (e?.pending) throw e;
    throw new Error(`\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437'\u0454\u0434\u043D\u0430\u0442\u0438\u0441\u044F \u0437 LP-CRM (${subdomain}.lp-crm.biz): ${e?.message || e}`);
  }
  for (let i = 0; res.status === 429 && i < RETRY_DELAYS_MS.length; i++) {
    await sleepFn(RETRY_DELAYS_MS[i]);
    res = await doFetch(`https://${subdomain}.lp-crm.biz/api/${method}.html`);
  }
  const text = await res.text();
  if (res.status === 429) {
    throw new Error("LP-CRM \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u043E \u043E\u0431\u043C\u0435\u0436\u0438\u043B\u0430 \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0437\u0430\u043F\u0438\u0442\u0456\u0432 (429). \u0417\u0430\u0447\u0435\u043A\u0430\u0439\u0442\u0435 \u0445\u0432\u0438\u043B\u0438\u043D\u0443 \u0456 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0421\u0444\u043E\u0440\u043C\u0443\u0432\u0430\u0442\u0438\xBB \u0449\u0435 \u0440\u0430\u0437.");
  }
  try {
    return JSON.parse(text);
  } catch {
    const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(`LP-CRM \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u043B\u0430 \u043D\u0435 JSON (HTTP ${res.status}): ${clean.slice(0, 200)}`);
  }
}
var ORDER_KEYS = ["products", "bayer_name", "order_id", "phone", "office", "delivery_adress"];
function findOrders(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 5) return [];
  if (!Array.isArray(node)) {
    const hits = ORDER_KEYS.filter((k) => k in node).length;
    if (hits >= 2) return [node];
  }
  return Object.values(node).flatMap((v) => findOrders(v, depth + 1));
}
var asList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object") return Object.values(data);
  return [];
};
var orderCache = /* @__PURE__ */ new Map();
var productCache = /* @__PURE__ */ new Map();
var ORDER_TTL = 60 * 1e3;
var PRODUCT_TTL = 60 * 60 * 1e3;
async function getOrder(fetchFn, creds, orderId, { fresh = false } = {}) {
  const ck = `${creds.subdomain}|${orderId}`;
  const hit = orderCache.get(ck);
  if (!fresh && hit && Date.now() - hit.at < ORDER_TTL) return hit.value;
  const value = await getOrderUncached(fetchFn, creds, orderId);
  orderCache.set(ck, { at: Date.now(), value });
  return value;
}
async function getOrderUncached(fetchFn, { subdomain, key }, orderId) {
  if (!subdomain || !key) {
    throw new Error("\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u043F\u0456\u0434\u0434\u043E\u043C\u0435\u043D \u0456 API-\u043A\u043B\u044E\u0447 \u0443 \u0440\u043E\u0437\u0434\u0456\u043B\u0456 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\xBB.");
  }
  const json = await call(fetchFn, subdomain, key, "getOrdersByID", { order_id: String(orderId) });
  if (json.status && json.status !== "ok") {
    const msg = typeof json.data === "string" ? json.data : json.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`LP-CRM: ${msg}`);
  }
  const list = findOrders(json.data ?? json);
  const order2 = list.find((o) => String(o.order_id ?? o.id) === String(orderId)) || list[0];
  if (!order2) {
    const excerpt = JSON.stringify(json).slice(0, 600);
    throw new Error(`\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u2116${orderId} \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0443 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456 LP-CRM. \u0412\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C: ${excerpt}`);
  }
  return { order: order2, raw: json };
}
function findProducts(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return [];
  if (!Array.isArray(node) && "name" in node && ("id" in node || "product_id" in node) && !("product_id" in node && "sub_id" in node)) return [node];
  return Object.values(node).flatMap((v) => findProducts(v, depth + 1));
}
async function getProducts(fetchFn, { subdomain, key }, ids) {
  const all = [...new Set(ids.filter(Boolean))];
  const cached = {};
  const unique = [];
  for (const id of all) {
    const h6 = productCache.get(`${subdomain}|${id}`);
    if (h6 && Date.now() - h6.at < PRODUCT_TTL) cached[id] = h6.value;
    else unique.push(id);
  }
  if (!unique.length) return cached;
  try {
    const json = await call(fetchFn, subdomain, key, "getProduct", { product_id: unique.join(","), status_ignore: "1" });
    const out = {};
    for (const p of findProducts(json.data)) {
      const id = String(p.id ?? p.product_id ?? "");
      if (!id) continue;
      const vendor = p.vendor && p.vendor !== "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" ? p.vendor : "";
      out[id] = { name: p.name || p.title || "", article: p.article || vendor || p.model || "" };
      productCache.set(`${subdomain}|${id}`, { at: Date.now(), value: out[id] });
    }
    return { ...cached, ...out };
  } catch {
    return cached;
  }
}
async function getStatuses(fetchFn, { subdomain, key }) {
  const json = await call(fetchFn, subdomain, key, "getStatuses", {});
  if (json.status !== "ok") throw new Error(`LP-CRM: ${json.message || "\u043D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u0438"}`);
  return json.data || {};
}
async function getOrderCodesByStatus(fetchFn, { subdomain, key }, status, dateStart, dateEnd) {
  const json = await call(fetchFn, subdomain, key, "getOrdersIdByStatus", { status: String(status), date_start: dateStart, date_end: dateEnd });
  if (json.status !== "ok") return [];
  return asList(json.data).map(String);
}
async function getOrdersBatch(fetchFn, { subdomain, key }, codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += 100) {
    const part = codes.slice(i, i + 100);
    const json = await call(fetchFn, subdomain, key, "getOrdersByID", { order_id: part.join(",") });
    if (json.status === "ok") out.push(...findOrders(json.data));
  }
  return out;
}
var ymd = (d) => d.toISOString().slice(0, 10);
async function diagnose(fetchFn, creds, orderId) {
  const lines = [];
  const log = (title, v) => lines.push(`\u25B6 ${title}
${(typeof v === "string" ? v : JSON.stringify(v, null, 1)).slice(0, 3e3)}`);
  try {
    log(`getOrdersByID ${orderId}`, await call(fetchFn, creds.subdomain, creds.key, "getOrdersByID", { order_id: String(orderId) }));
    const end = /* @__PURE__ */ new Date();
    const start = new Date(Date.now() - 3 * 864e5);
    const codes = await getOrderCodesByStatus(fetchFn, creds, 11, ymd(start), ymd(end));
    log("getOrdersIdByStatus 11 (\u043E\u0441\u0442\u0430\u043D\u043D\u0456 3 \u0434\u043D\u0456)", codes.slice(0, 10));
    if (codes.length) {
      const one = await call(fetchFn, creds.subdomain, creds.key, "getOrdersByID", { order_id: codes[0] });
      log(`getOrdersByID ${codes[0]} (\u043F\u0440\u0438\u043A\u043B\u0430\u0434)`, one);
      const order2 = findOrders(one.data)[0];
      const pid = order2?.products && asList(order2.products)[0]?.product_id;
      if (pid) log(`getProduct ${pid}`, await call(fetchFn, creds.subdomain, creds.key, "getProduct", { product_id: String(pid), status_ignore: "1" }));
    }
  } catch (e) {
    log("\u041F\u041E\u041C\u0418\u041B\u041A\u0410", e.message);
  }
  return lines.join("\n\n");
}
var utf8Len = (s) => new TextEncoder().encode(s).length;
function phpSerialize(v) {
  if (v === null || v === void 0) return "N;";
  if (typeof v === "boolean") return `b:${v ? 1 : 0};`;
  if (typeof v === "number" && Number.isInteger(v)) return `i:${v};`;
  if (typeof v === "number") return `d:${v};`;
  if (typeof v === "string") return `s:${utf8Len(v)}:"${v}";`;
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  return `a:${entries.length}:{${entries.map(([k, x]) => (typeof k === "number" ? `i:${k};` : phpSerialize(String(k))) + phpSerialize(x)).join("")}}`;
}
var phpUrlencode = (s) => encodeURIComponent(s).replace(/[!'()*~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
var CRM_ID_KEYS = ["crm_id", "order_crm_id", "lp_order_id", "id"];
function findNewOrderId(node, sentCode, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return "";
  for (const k of CRM_ID_KEYS) {
    const v = node[k];
    if ((typeof v === "number" || typeof v === "string") && /^[1-9]\d{0,9}$/.test(String(v)) && String(v) !== String(sentCode)) return String(v);
  }
  const oid = node.order_id;
  if ((typeof oid === "number" || typeof oid === "string") && /^[1-9]\d{0,9}$/.test(String(oid)) && String(oid) !== String(sentCode)) return String(oid);
  for (const x of Object.values(node)) {
    const r = findNewOrderId(x, sentCode, depth + 1);
    if (r) return r;
  }
  return "";
}
async function addNewOrder(fetchFn, { subdomain, key }, order2) {
  const { products, ...rest } = order2;
  const params = {
    order_id: String(order2.code),
    country: "UA",
    ...Object.fromEntries(Object.entries(rest).filter(([k, v]) => k !== "code" && v !== void 0 && v !== null && v !== "").map(([k, v]) => [k, String(v)])),
    products: phpUrlencode(phpSerialize(products.map((p) => ({ product_id: String(p.product_id), price: String(p.price), count: String(p.count) }))))
  };
  const json = await call(fetchFn, subdomain, key, "addNewOrder", params);
  const failed = json.status && json.status !== "ok";
  const inner = Array.isArray(json.data) ? json.data[0] : json.data;
  const innerFailed = inner && typeof inner === "object" && inner.status && inner.status !== "ok";
  if (failed || innerFailed) {
    const why = [json.message, typeof json.data === "string" ? json.data : "", inner?.message, inner?.error].filter(Boolean).join(" \xB7 ");
    return { ok: false, error: why || JSON.stringify(json).slice(0, 300), raw: json };
  }
  return { ok: true, crmId: findNewOrderId(json.data ?? json, order2.code), raw: json };
}

// src/modules/nakladni/normalize.js
var pick = (obj, keys) => {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (v !== void 0 && v !== null && String(v).trim() !== "") return v;
  }
  return "";
};
var num2 = (v) => {
  if (v === "" || v === null || v === void 0) return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
var round22 = (n) => Math.round(n * 100) / 100;
var textOnly = (v) => /^\s*\d*\s*$/.test(String(v)) ? "" : String(v);
function normalizeOrder(raw2, productNames = {}) {
  const productsRaw = raw2.products || raw2.goods || raw2.items || [];
  const list = Array.isArray(productsRaw) ? productsRaw : Object.values(productsRaw);
  const items = list.map((p) => {
    const productId = String(pick(p, ["product_id", "id", "productId"]) || "");
    const qty = num2(pick(p, ["quantity", "count", "qty", "amount"])) || 1;
    const price = num2(pick(p, ["price", "cost", "price_sale"]));
    const known = productNames[productId] || {};
    const name = pick(p, ["name", "title", "product_name", "product_title"]) || known.name || (productId ? `\u0422\u043E\u0432\u0430\u0440 #${productId}` : "\u0422\u043E\u0432\u0430\u0440");
    let article = String(pick(p, ["article", "sku", "code", "vendor_code"]) || known.article || "");
    let cleanName = String(name);
    const br = cleanName.match(/^(.*\S)\s*\[([^\]]{1,40})\]\s*$/);
    if (br && !article) {
      cleanName = br[1];
      article = br[2];
    }
    return {
      productId,
      name: cleanName,
      article,
      unit: "\u0448\u0442",
      qty,
      price: round22(price),
      sum: round22(qty * price)
    };
  });
  const itemsTotal = round22(items.reduce((s, i) => s + i.sum, 0));
  const discount = num2(pick(raw2, ["discount", "sale", "discount_sum"]));
  const deliveryCost = num2(pick(raw2, ["delivery_price", "delivery_cost"]));
  const crmTotal = num2(pick(raw2, ["total", "total_sum", "sum", "order_sum"]));
  return {
    orderId: String(pick(raw2, ["order_id", "id", "orderId"])),
    shortId: raw2.order_id && raw2.id && String(raw2.id) !== String(raw2.order_id) ? String(raw2.id) : "",
    date: String(pick(raw2, ["order_time", "date", "created_at", "datetime"])),
    status: String(pick(raw2, ["status", "status_id"])),
    office: String(pick(raw2, ["office", "office_id", "department"])),
    buyer: {
      name: String(pick(raw2, ["bayer_name", "buyer_name", "fio", "name", "client_name"])),
      phone: String(pick(raw2, ["phone", "buyer_phone", "tel"])),
      email: String(pick(raw2, ["email", "mail"]))
    },
    delivery: {
      method: textOnly(pick(raw2, ["delivery_name", "delivery"])),
      address: String(pick(raw2, ["delivery_adress", "delivery_address", "address", "city"])),
      ttn: String(pick(raw2, ["ttn", "ttn_number", "declaration"]))
    },
    payment: textOnly(pick(raw2, ["payment_name", "payment"])),
    comment: String(pick(raw2, ["comment", "note"])),
    channel: String(pick(raw2, ["additional_1"])).trim(),
    items,
    itemsTotal,
    discount: round22(discount),
    deliveryCost: round22(deliveryCost),
    total: round22(itemsTotal - discount + deliveryCost),
    crmTotal: crmTotal ? round22(crmTotal) : null,
    receiptHint: String(pick(raw2, ["receipt_id", "check_id", "fiscal_code", "checkbox_id", "receipt"]))
  };
}
function applyEdits(order2, edits) {
  if (!edits) return order2;
  const o = structuredClone(order2);
  if (edits.buyer) o.buyer = { ...o.buyer, ...edits.buyer };
  if (edits.delivery) o.delivery = { ...o.delivery, ...edits.delivery };
  if (edits.payment !== void 0) o.payment = edits.payment;
  if (edits.comment !== void 0) o.comment = edits.comment;
  if (edits.date !== void 0 && edits.date !== "") o.invoiceDate = edits.date;
  if (Array.isArray(edits.items)) {
    o.items = edits.items.map((i) => {
      const qty = num2(i.qty);
      const price = num2(i.price);
      return {
        productId: i.productId || "",
        name: String(i.name || ""),
        article: String(i.article || ""),
        unit: i.unit || "\u0448\u0442",
        qty,
        price: round22(price),
        sum: round22(qty * price)
      };
    });
  }
  if (edits.discount !== void 0) o.discount = round22(num2(edits.discount));
  if (edits.deliveryCost !== void 0) o.deliveryCost = round22(num2(edits.deliveryCost));
  o.itemsTotal = round22(o.items.reduce((s, i) => s + i.sum, 0));
  o.total = round22(o.itemsTotal - o.discount + o.deliveryCost);
  o.edited = true;
  return o;
}

// src/modules/nakladni/demo.js
var DEMO_ORDER = {
  order_id: "demo",
  order_time: "2026-10-12 14:35:00",
  status: "11",
  office: "25",
  bayer_name: "\u041A\u043E\u0432\u0430\u043B\u0435\u043D\u043A\u043E \u041E\u043B\u0435\u043D\u0430 \u041F\u0435\u0442\u0440\u0456\u0432\u043D\u0430",
  phone: "380671234567",
  email: "olena@example.com",
  delivery: "\u041D\u043E\u0432\u0430 \u041F\u043E\u0448\u0442\u0430",
  delivery_adress: "\u043C. \u041A\u0438\u0457\u0432, \u0412\u0456\u0434\u0434\u0456\u043B\u0435\u043D\u043D\u044F \u211612, \u0432\u0443\u043B. \u0412\u0435\u043B\u0438\u043A\u0430 \u0412\u0430\u0441\u0438\u043B\u044C\u043A\u0456\u0432\u0441\u044C\u043A\u0430, 72",
  ttn: "20450912345678",
  payment: "\u041F\u0456\u0441\u043B\u044F\u043F\u043B\u0430\u0442\u0430 NovaPay",
  comment: "\u041F\u043E\u0434\u0437\u0432\u043E\u043D\u0438\u0442\u0438 \u043F\u0435\u0440\u0435\u0434 \u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043A\u043E\u044E",
  products: [
    { product_id: "101", name: "\u0420\u0435\u043A\u0443\u043F\u0435\u0440\u0430\u0442\u043E\u0440 Ecovent VS-60 Pro", article: "EV-VS60", price: "6450", count: "1" },
    { product_id: "102", name: "\u0417\u043E\u0432\u043D\u0456\u0448\u043D\u044F \u0440\u0435\u0448\u0456\u0442\u043A\u0430, \u0431\u0456\u043B\u0430", article: "EV-GR100", price: "390", count: "2" },
    { product_id: "103", name: "\u0424\u0456\u043B\u044C\u0442\u0440 \u0437\u043C\u0456\u043D\u043D\u0438\u0439 G3 (\u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442 2 \u0448\u0442)", article: "EV-F-G3", price: "280", count: "1" }
  ]
};

// src/modules/nakladni/index.js
var docFop = (f) => {
  if (!f) return null;
  const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
  return rest;
};
function mountNakladni(app, { db, fetchFn, onCleanup, shared: shared2 = {} }) {
  const settings = () => loadSettings(db);
  shared2.receiptCache ||= /* @__PURE__ */ new Map();
  const receiptCache = shared2.receiptCache;
  onCleanup((border) => db.run(`DELETE FROM versions WHERE created_at < ?`, [border]));
  onCleanup(async () => {
    const days = (Number((await settings()).lpcrm_search_days) || 30) + 7;
    const border = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    await db.batch([
      [`DELETE FROM orders_index WHERE datetime != '' AND datetime < ?`, [border]],
      [`DELETE FROM order_keys WHERE day != '' AND day < ?`, [border]]
    ]);
  });
  app.get("/api/lpcrm/diagnose/:orderId", async (c) => {
    need(c, "api");
    const s = await settings();
    const text = await diagnose(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param("orderId"));
    return c.json({ text });
  });
  app.get("/api/lpcrm/raw/:orderId", async (c) => {
    need(c, "api");
    const s = await settings();
    const { raw: raw2 } = await getOrder(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param("orderId"), { fresh: true });
    return c.json(raw2);
  });
  const ymd2 = (d) => d.toISOString().slice(0, 10);
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const ACCEPTED_RE = /^(принят|прийнят)/i;
  const ID_RE2 = /^[1-9]\d{0,8}$/;
  shared2.acceptedCodes ||= /* @__PURE__ */ new Map();
  const orderKeys = (o) => {
    const ks = [o.id, o.order_id, o.ttn].map((x) => String(x ?? "").trim()).filter(Boolean);
    const p = digits(o.phone);
    if (p.length >= 9) ks.push(`p:${p.slice(-9)}`);
    return [...new Set(ks)];
  };
  async function saveOrders2(orders) {
    const now = nowIso();
    const keys = orders.flatMap((o) => orderKeys(o).map((k) => [
      `INSERT OR IGNORE INTO order_keys (k, code, day) VALUES (?, ?, ?)`,
      [k, String(o.order_id), String(o.datetime || "").slice(0, 10)]
    ]));
    await db.batch([...keys, ...orders.map((o) => [
      `INSERT INTO orders_index (code, datetime, phone, ttn, bayer_name, data, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET datetime = excluded.datetime, phone = excluded.phone, ttn = excluded.ttn,
       bayer_name = excluded.bayer_name, data = excluded.data, fetched_at = excluded.fetched_at`,
      [String(o.order_id), o.datetime || "", digits(o.phone), String(o.ttn || ""), o.bayer_name || "", JSON.stringify(o), now]
    ])]);
  }
  async function crmStatuses(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache?.map && cache.sub === creds.subdomain && Date.now() - cache.at < 864e5) return cache.map;
    const map = await getStatuses(fetchFn, creds);
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
      JSON.stringify({ at: Date.now(), sub: creds.subdomain, map })
    ]);
    return map;
  }
  const statusName = (map, id) => String((map[id]?.name ?? map[id]) || id || "").trim();
  async function acceptedIds(creds) {
    const map = await crmStatuses(creds);
    const ids = Object.keys(map).filter((id) => ACCEPTED_RE.test(statusName(map, id)));
    return { ids: ids.length ? ids : ["11"], map };
  }
  async function acceptedCodes(creds, days) {
    const key = `${creds.subdomain}|${days}`;
    const hit = shared2.acceptedCodes.get(key);
    if (hit && Date.now() - hit.at < 3 * 6e4) return hit.codes;
    const { ids } = await acceptedIds(creds);
    const start = ymd2(new Date(Date.now() - days * 864e5));
    const end = ymd2(new Date(Date.now() + 864e5));
    const codes = [...new Set((await Promise.all(ids.map((id) => getOrderCodesByStatus(fetchFn, creds, id, start, end)))).flat())];
    shared2.acceptedCodes.set(key, { at: Date.now(), codes });
    return codes;
  }
  async function loadAccepted(creds, days) {
    const codes = await acceptedCodes(creds, days);
    const known = new Set((await db.all(`SELECT code FROM orders_index WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(codes)])).map((r) => r.code));
    const fresh = codes.filter((c) => !known.has(c));
    for (let k = 0; k < fresh.length; k += 100) await saveOrders2(await getOrdersBatch(fetchFn, creds, fresh.slice(k, k + 100)));
    return codes;
  }
  const findById = (q, codes = null) => db.get(
    `SELECT o.code FROM order_keys k JOIN orders_index o ON o.code = k.code
     WHERE k.k = ? ${codes ? "AND o.code IN (SELECT value FROM json_each(?))" : ""} ORDER BY o.datetime DESC LIMIT 1`,
    codes ? [q, JSON.stringify(codes)] : [q]
  );
  const notAccepted = (q, days, maxDays, now = "") => Object.assign(
    new Error(`\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u2116 ${q} \u043D\u0435\u043C\u0430\u0454 \u0432 CRM \u0443 \u0441\u0442\u0430\u0442\u0443\u0441\u0456 \xAB\u041F\u0440\u0438\u0439\u043D\u044F\u0442\u043E\xBB${days ? ` \u0437\u0430 \u043E\u0441\u0442\u0430\u043D\u043D\u0456 ${days} \u0434\u043D\u0456\u0432` : ""}${now ? ` (\u0437\u0430\u0440\u0430\u0437: \xAB${now}\xBB)` : ""}.`),
    { status: 404, extra: { canExtend: Boolean(days) && days < maxDays, extendDays: maxDays } }
  );
  async function resolveCode(q, s, creds) {
    if (!ID_RE2.test(q)) {
      throw fail(400, "\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u043D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F: \u0432\u0432\u0435\u0434\u0456\u0442\u044C ID \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0437 LP-CRM \u2014 \u043B\u0438\u0448\u0435 \u0446\u0438\u0444\u0440\u0438, \u043D\u0430\u043F\u0440. 108008 (\u043D\u0435 \u043A\u043E\u0434 ID-o, \u043D\u0435 \u0442\u0435\u043B\u0435\u0444\u043E\u043D \u0456 \u043D\u0435 \u0422\u0422\u041D).");
    }
    const days = Math.max(1, Number(s.lpcrm_search_days) || 30);
    const maxDays = days;
    let row = await findById(q);
    if (!row) row = await findById(q, await loadAccepted(creds, days));
    if (!row) throw notAccepted(q, days, maxDays);
    return { code: row.code, days, maxDays };
  }
  async function loadOrder(orderId, s, fresh = false) {
    if (orderId === "demo" || orderId === "0") {
      return { rawOrder: DEMO_ORDER, demo: true };
    }
    const creds = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    if (!creds.subdomain || !creds.key) throw new Error("\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u043F\u0456\u0434\u0434\u043E\u043C\u0435\u043D \u0456 API-\u043A\u043B\u044E\u0447 \u0443 \u0440\u043E\u0437\u0434\u0456\u043B\u0456 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\xBB.");
    const { code, maxDays } = await resolveCode(orderId, s, creds);
    const { order: order2, raw: raw2 } = await getOrder(fetchFn, creds, code, { fresh });
    const { ids, map } = await acceptedIds(creds);
    const st = String(order2.status ?? order2.status_id ?? "");
    if (!ids.includes(st)) throw notAccepted(orderId, 0, maxDays, statusName(map, st));
    const note = "";
    const prods = order2.products || order2.goods || [];
    const list = Array.isArray(prods) ? prods : Object.values(prods);
    const missing = list.filter((p) => !(p.name || p.title || p.product_name)).map((p) => String(p.product_id ?? p.id ?? ""));
    const productNames = missing.length ? await getProducts(fetchFn, creds, missing) : {};
    return { rawOrder: order2, crmRaw: raw2, productNames, demo: false, code, note };
  }
  async function buildInvoice(orderId, { skipCheckbox = false, fresh = false } = {}) {
    const s = await settings();
    const { rawOrder, crmRaw, productNames, demo, code, note } = await loadOrder(orderId, s, fresh);
    const crmOrder = normalizeOrder(rawOrder, productNames);
    if (demo) crmOrder.orderId = "demo";
    if (!crmOrder.orderId) crmOrder.orderId = String(orderId);
    if (!demo && crmOrder.shortId) crmOrder.orderId = crmOrder.shortId;
    else if (!demo && /^\d{1,8}$/.test(orderId)) crmOrder.orderId = String(orderId);
    const prefs = await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId]);
    const edits = prefs?.edits ? JSON.parse(prefs.edits) : null;
    const today2 = kyivDay();
    const autoInvoiceDate = s.invoice_date_mode === "order" ? String(crmOrder.date || "").slice(0, 10) || today2 : today2;
    crmOrder.invoiceDate = autoInvoiceDate;
    const order2 = applyEdits(crmOrder, edits);
    const allFops = await db.all(`SELECT * FROM fops WHERE active = 1`);
    const byId = (id) => allFops.find((f) => String(f.id) === String(id)) || null;
    const warnings = [];
    if (note) warnings.push(note);
    if (!crmOrder.items.length) warnings.push("\u0423 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0442\u043E\u0432\u0430\u0440\u0456\u0432 \u2014 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u0431\u043B\u043E\u043A \xAB\u0414\u0430\u043D\u0456 \u0437 CRM\xBB \u0443\u043D\u0438\u0437\u0443 \u0456 \u043D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u0441\u043A\u0440\u0456\u043D\u0448\u043E\u0442 \u0441\u0438\u0440\u043E\u0457 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456.");
    let receipt = null;
    let receiptCandidates = [];
    const cbFops = allFops.filter(hasCheckbox);
    const receiptRef = prefs?.receipt_ref || crmOrder.receiptHint;
    if (!skipCheckbox && cbFops.length && (receiptRef || s.checkbox_enabled === "1")) {
      try {
        const cacheKey = `${orderId}|${receiptRef}|${order2.total}|${order2.date}|${cbFops.map((f) => f.id).join(",")}`;
        const hit = receiptCache.get(cacheKey);
        let r;
        if (hit && Date.now() - hit.at < 10 * 60 * 1e3) r = hit.r;
        else {
          r = receiptRef ? await findReceiptByRef(fetchFn, cbFops, receiptRef) : await findReceiptForOrder(fetchFn, cbFops, order2, { days: Number(s.checkbox_search_days) || 7 });
          if (r.receipt) receiptCache.set(cacheKey, { at: Date.now(), r });
        }
        receipt = r.receipt;
        receiptCandidates = r.candidates || [];
        warnings.push(...r.errors);
        if (!receipt && receiptRef) warnings.push(`\u0427\u0435\u043A \xAB${receiptRef}\xBB \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0432 \u0436\u043E\u0434\u043D\u043E\u043C\u0443 \u0430\u043A\u0430\u0443\u043D\u0442\u0456 Checkbox.`);
      } catch (e) {
        warnings.push(`Checkbox: ${e.message}`);
      }
    }
    const office = crmOrder.office ? await db.get(`SELECT * FROM offices WHERE office_id = ?`, [crmOrder.office]) : null;
    const officeFop = office?.fop_id ? byId(office.fop_id) : null;
    if (crmOrder.office && !office) warnings.push(`\u0412\u0456\u0434\u0434\u0456\u043B ${crmOrder.office} \u043D\u0435 \u0434\u043E\u0434\u0430\u043D\u043E \u0432 \u0434\u043E\u0432\u0456\u0434\u043D\u0438\u043A \u0432\u0456\u0434\u0434\u0456\u043B\u0456\u0432.`);
    let channelFop = null;
    let ch = null;
    if (crmOrder.channel) {
      ch = (await db.all(`SELECT * FROM channels`)).find((x) => x.name.trim().toLowerCase() === crmOrder.channel.toLowerCase());
      channelFop = ch?.fop_id ? byId(ch.fop_id) : null;
      if (!ch) warnings.push(`\u0417\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u043F\u043E\u043B\u044F 1 \xAB${crmOrder.channel}\xBB \u043D\u0435 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u0435 \u0434\u043E \u0424\u041E\u041F (\u0440\u043E\u0437\u0434\u0456\u043B \xAB\u0412\u0456\u0434\u0434\u0456\u043B\u0438 \u2192 \u0424\u041E\u041F\xBB).`);
    }
    let fop = null;
    let fopSource = "";
    const manual = prefs?.fop_id ? byId(prefs.fop_id) : null;
    if (manual) {
      fop = manual;
      fopSource = "manual";
    } else if (receipt) {
      fop = byId(receipt.fopId);
      fopSource = "receipt";
    } else if (channelFop) {
      fop = channelFop;
      fopSource = "channel";
    } else if (officeFop) {
      fop = officeFop;
      fopSource = "office";
    } else if (s.default_fop_id && byId(s.default_fop_id)) {
      fop = byId(s.default_fop_id);
      fopSource = "default";
    }
    if (channelFop && officeFop && String(channelFop.id) !== String(officeFop.id) && !receipt) {
      warnings.push(`\u0417\u0430 \u043F\u043E\u043B\u0435\u043C 1 \u2014 ${channelFop.short_name}, \u0430 \u0437\u0430 \u0432\u0456\u0434\u0434\u0456\u043B\u043E\u043C \u2014 ${officeFop.short_name}. \u041F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u0424\u041E\u041F.`);
    }
    const autoFop = channelFop || officeFop;
    if (receipt && autoFop && String(receipt.fopId) !== String(autoFop.id)) {
      warnings.push(`\u0417\u0430 ${channelFop ? "\u043F\u043E\u043B\u0435\u043C 1" : "\u0432\u0456\u0434\u0434\u0456\u043B\u043E\u043C"} \u043C\u0430\u0432 \u0431\u0438 \u0431\u0443\u0442\u0438 ${autoFop.short_name}, \u0430\u043B\u0435 \u0447\u0435\u043A \u043F\u0440\u043E\u0431\u0438\u0442\u043E \u043D\u0430 ${receipt.fopName}.`);
    }
    if (manual && receipt && String(receipt.fopId) !== String(manual.id)) {
      warnings.push(`\u041E\u0431\u0440\u0430\u043D\u043E \u0432\u0440\u0443\u0447\u043D\u0443 ${manual.short_name}, \u0430 \u0447\u0435\u043A \u043F\u0440\u043E\u0431\u0438\u0442\u043E \u043D\u0430 ${receipt.fopName}.`);
    }
    if (!fop) warnings.push("\u0424\u041E\u041F \u043D\u0435 \u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u043E \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0437\u0456 \u0441\u043F\u0438\u0441\u043A\u0443.");
    else {
      const missing = [];
      if (!fop.full_name) missing.push("\u041F\u0406\u0411");
      if (!fop.ipn) missing.push("\u0406\u041F\u041D");
      if (missing.length) warnings.push(`\u0423 ${fop.short_name} \u043D\u0435 \u0437\u0430\u043F\u043E\u0432\u043D\u0435\u043D\u043E: ${missing.join(", ")}.`);
    }
    const fits = (row) => row && row.seller_text && (!row.fop_id || String(row.fop_id) === String(fop?.id));
    let sellerText = "";
    let sellerTextSource = "";
    if (edits?.sellerText) {
      sellerText = edits.sellerText;
      sellerTextSource = "manual";
    } else if (fits(ch)) {
      sellerText = ch.seller_text;
      sellerTextSource = `\u043F\u043E\u043B\u0435 1 \xAB${ch.name}\xBB`;
    } else if (fits(office)) {
      sellerText = office.seller_text;
      sellerTextSource = `\u0432\u0456\u0434\u0434\u0456\u043B ${office.office_id}`;
    }
    const tplId = prefs?.template_id || fop?.template_id;
    let template = tplId ? await db.get(`SELECT * FROM templates WHERE id = ?`, [tplId]) : null;
    if (!template) template = await db.get(`SELECT * FROM templates ORDER BY id LIMIT 1`);
    return {
      order: order2,
      crmOrder,
      demo,
      edited: Boolean(edits),
      edits,
      office: office || (crmOrder.office ? { office_id: crmOrder.office, name: "" } : null),
      fop: docFop(fop),
      sellerText,
      sellerTextSource,
      autoInvoiceDate,
      fopSource,
      officeFopId: officeFop?.id || null,
      receipt,
      receiptCandidates,
      receiptRef: prefs?.receipt_ref || "",
      template: parseTpl(template),
      templateManual: Boolean(prefs?.template_id),
      warnings,
      sellerNote: s.seller_note || "",
      crmCode: code || "",
      crmRaw: crmRaw ? JSON.stringify(crmRaw, null, 2).slice(0, 2e4) : ""
    };
  }
  const snapshotOf = ({ crmRaw, receiptCandidates, versionsCount, requestedId, ...rest }) => rest;
  async function addVersion(orderId, inv, reason, who = "") {
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    await db.run(
      `INSERT INTO versions (order_id, created_at, reason, fop_id, fop_name, template_id, total, data_hash, data, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        nowIso(),
        reason,
        inv.fop?.id || null,
        inv.fop?.short_name || "",
        inv.template?.id || null,
        inv.order.total,
        dataHash,
        JSON.stringify(snapshotOf(inv)),
        who
      ]
    );
  }
  async function trackChanges(orderId, inv, who = "") {
    const last = await db.get(`SELECT data_hash FROM versions WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [orderId]);
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    if (!last) await addVersion(orderId, inv, "\u041F\u0435\u0440\u0448\u0435 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0442\u044F", who);
    else if (last.data_hash !== dataHash) await addVersion(orderId, inv, "\u0417\u043C\u0456\u043D\u0438\u043B\u0438\u0441\u044F \u0434\u0430\u043D\u0456 (CRM, \u0424\u041E\u041F \u0430\u0431\u043E \u0448\u0430\u0431\u043B\u043E\u043D)", who);
  }
  app.get("/api/invoice/:orderId", async (c) => {
    const orderId = c.req.param("orderId").trim().replace(/^№/, "");
    const inv = await buildInvoice(orderId, { fresh: c.req.query("fresh") === "1" });
    await trackChanges(orderId, inv, userName(c));
    const n = await db.get(`SELECT COUNT(*) AS n FROM versions WHERE order_id = ?`, [orderId]);
    return c.json({ ...inv, versionsCount: n?.n || 0 });
  });
  app.put("/api/invoice/:orderId/prefs", async (c) => {
    need(c, "docs.edit");
    const orderId = c.req.param("orderId");
    const b = await c.req.json();
    const cur = await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId]) || {};
    const next = {
      fop_id: b.fop_id !== void 0 ? b.fop_id || null : cur.fop_id ?? null,
      template_id: b.template_id !== void 0 ? b.template_id || null : cur.template_id ?? null,
      receipt_ref: b.receipt_ref !== void 0 ? b.receipt_ref || "" : cur.receipt_ref || "",
      edits: b.edits !== void 0 ? b.edits ? JSON.stringify(b.edits) : "" : cur.edits || ""
    };
    await db.run(
      `INSERT INTO order_prefs (order_id, fop_id, template_id, receipt_ref, edits, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET fop_id = excluded.fop_id, template_id = excluded.template_id,
       receipt_ref = excluded.receipt_ref, edits = excluded.edits, updated_at = excluded.updated_at`,
      [orderId, next.fop_id, next.template_id, next.receipt_ref, next.edits, nowIso()]
    );
    const inv = await buildInvoice(orderId);
    const reason = b.reason || "\u0417\u043C\u0456\u043D\u0430 \u0432\u0440\u0443\u0447\u043D\u0443";
    await addVersion(orderId, inv, reason, userName(c));
    return c.json({ ok: true });
  });
  app.post("/api/invoice/:orderId/versions", async (c) => {
    const orderId = c.req.param("orderId");
    const b = await c.req.json();
    if (!b.snapshot?.order) return c.json({ error: "\u041D\u0435\u043C\u0430\u0454 \u0434\u0430\u043D\u0438\u0445 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u043E\u0457" }, 400);
    await addVersion(orderId, b.snapshot, b.reason || "\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E", userName(c));
    return c.json({ ok: true });
  });
  app.get("/api/invoice/:orderId/versions", async (c) => {
    const rows = await db.all(
      `SELECT id, order_id, created_at, reason, fop_name, template_id, total, user_name FROM versions WHERE order_id = ? ORDER BY id DESC`,
      [c.req.param("orderId")]
    );
    return c.json(rows);
  });
  app.get("/api/versions/:id", async (c) => {
    const row = await db.get(`SELECT * FROM versions WHERE id = ?`, [c.req.param("id")]);
    if (!row) return c.json({ error: "\u0412\u0435\u0440\u0441\u0456\u044E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E" }, 404);
    return c.json({ ...row, data: JSON.parse(row.data) });
  });
  app.get("/api/history", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const fop = (c.req.query("fop") || "").trim();
    const where = [];
    const params = [];
    if (q) {
      where.push("order_id LIKE ?");
      params.push(`%${q}%`);
    }
    if (fop) {
      where.push("fop_id = ?");
      params.push(fop);
    }
    const rows = await db.all(
      `SELECT v.order_id, v.id AS last_id, v.created_at AS last_at, v.fop_name, v.total,
        (SELECT COUNT(*) FROM versions c WHERE c.order_id = v.order_id) AS versions
       FROM versions v
       WHERE v.id IN (SELECT MAX(id) FROM versions GROUP BY order_id) ${where.length ? "AND " + where.map((w) => "v." + w).join(" AND ") : ""}
       ORDER BY v.id DESC LIMIT 200`,
      params
    );
    return c.json(rows);
  });
  return { loadOrder };
}

// src/modules/admin/index.js
function mountAdmin(app, { db }) {
  const settings = () => loadSettings(db);
  const EXPORT_TABLES = ["templates", "fops", "offices", "channels", "inv_fops"];
  const HISTORY_TABLES = ["order_prefs", "versions"];
  const EXPORT_SETTINGS = [
    "lpcrm_subdomain",
    "lpcrm_search_days",
    "default_fop_id",
    "checkbox_enabled",
    "checkbox_search_days",
    "invoice_date_mode",
    "rahunok_next_number",
    "retention_days",
    "seller_note"
  ];
  const SECRET_COLS = /* @__PURE__ */ new Set(["checkbox_password", "checkbox_pin", "checkbox_license", "checkbox_login"]);
  app.get("/api/admin/export", async (c) => {
    need(c, "users");
    const out = { version: 1, exported_at: nowIso(), tables: {}, settings: {} };
    for (const t of [...EXPORT_TABLES, ...HISTORY_TABLES]) {
      out.tables[t] = (await db.all(`SELECT * FROM ${t}`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLS.has(k))));
    }
    const s = await settings();
    for (const k of EXPORT_SETTINGS) if (s[k] !== void 0) out.settings[k] = s[k];
    return c.json(out);
  });
  app.get("/api/audit", async (c) => {
    need(c, "users");
    const kind = String(c.req.query("kind") || "");
    const ref = String(c.req.query("ref") || "");
    const rows = await db.all(
      `SELECT id, at, user_name, kind, ref_id, action, changes FROM audit_log
       ${kind ? `WHERE kind = ?${ref ? " AND ref_id = ?" : ""}` : ""} ORDER BY id DESC LIMIT 100`,
      kind ? ref ? [kind, ref] : [kind] : []
    );
    return c.json(rows.map((r) => ({ ...r, changes: JSON.parse(r.changes || "[]") })));
  });
  app.post("/api/admin/import", async (c) => {
    need(c, "users");
    const b = await c.req.json();
    if (!b?.tables) throw fail(400, "\u0426\u0435 \u043D\u0435 \u0444\u0430\u0439\u043B \u0435\u043A\u0441\u043F\u043E\u0440\u0442\u0443 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u044C.");
    const counts = {};
    const st = [];
    for (const t of EXPORT_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      const cols = new Set((await db.all(`PRAGMA table_info(${t})`)).map((x) => x.name));
      st.push([`DELETE FROM ${t}`, []]);
      for (const r0 of rows) {
        const r = dropUnsafeImages(r0 || {});
        const keys = Object.keys(r).filter((k) => cols.has(k) && !SECRET_COLS.has(k));
        if (!keys.length) continue;
        st.push([`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => r[k])]);
      }
      counts[t] = rows.length;
    }
    for (const [k, v] of Object.entries(b.settings || {})) {
      if (!EXPORT_SETTINGS.includes(k)) continue;
      if (k === "lpcrm_subdomain" && !/^[a-z0-9-]{1,63}$/i.test(String(v).trim())) continue;
      st.push([`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v)]]);
    }
    await db.batch(st);
    await logAudit(db, { user: c.get("user"), kind: "settings", action: "\u0456\u043C\u043F\u043E\u0440\u0442 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u044C", changes: Object.entries(counts).map(([field, n]) => ({ field, from: "", to: `${n} \u0440\u044F\u0434\u043A\u0456\u0432` })) });
    return c.json({ ok: true, counts });
  });
}

// src/core/counters.js
var FIRST = 10516;
async function takeRahunokNumber(db) {
  const r = await db.get(
    `UPDATE settings SET value = CAST(COALESCE(NULLIF(CAST(value AS INTEGER), 0), ${FIRST}) + 1 AS TEXT)
     WHERE key = 'rahunok_next_number' RETURNING CAST(value AS INTEGER) - 1 AS n`
  );
  if (r?.n) return String(r.n);
  await db.run(`INSERT INTO settings (key, value) VALUES ('rahunok_next_number', ?) ON CONFLICT(key) DO NOTHING`, [String(FIRST + 1)]);
  return String(FIRST);
}
var peekRahunokNumber = (s) => String(Number(s.rahunok_next_number) || FIRST);

// src/modules/rahunky/index.js
function mountRahunky(app, { db, services, onCleanup }) {
  const settings = () => loadSettings(db);
  const loadOrder = (...a) => services.nakladni.loadOrder(...a);
  onCleanup((border) => db.run(`DELETE FROM invoices WHERE COALESCE(updated_at, created_at) < ?`, [border]));
  const INV_FOP_FIELDS = ["short_name", "full_name", "ipn", "iban", "bank", "address", "phone", "warning_text", "signature", "stamp", "active"];
  app.post("/api/inv-fops", async (c) => {
    need(c, "users");
    const b = await c.req.json();
    if (!String(b.short_name || "").trim()) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0440\u043E\u0442\u043A\u0443 \u043D\u0430\u0437\u0432\u0443 \u0424\u041E\u041F.");
    checkImages(b, fail);
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== void 0);
    const r = await db.run(`INSERT INTO inv_fops (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((k) => b[k]));
    await logAudit(db, { user: c.get("user"), kind: "inv_fop", refId: r.lastId, action: "\u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E", changes: describeChanges({}, b, changedFields({}, b, INV_FOP_REQUISITES)) });
    return c.json({ id: r.lastId });
  });
  app.put("/api/inv-fops/:id", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    checkImages(b, fail);
    const cur = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [c.req.param("id")]);
    if (!cur) throw fail(404, "\u0424\u041E\u041F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const req2 = changedFields(cur, b, INV_FOP_REQUISITES);
    if (req2.length && !can(c.get("user"), "requisites")) throw fail(403, REQUISITES_DENIED);
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== void 0);
    if (cols.length) {
      await db.run(`UPDATE inv_fops SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...cols.map((k) => b[k]), cur.id]);
    }
    if (req2.length) await logAudit(db, { user: c.get("user"), kind: "inv_fop", refId: cur.id, action: "\u0437\u043C\u0456\u043D\u0435\u043D\u043E \u0440\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0438", changes: describeChanges(cur, b, req2) });
    return c.json({ ok: true });
  });
  app.delete("/api/inv-fops/:id", async (c) => {
    need(c, "users");
    const f = await db.get(`SELECT id, odb_id FROM inv_fops WHERE id = ?`, [c.req.param("id")]);
    if (!f) throw fail(404, "\u0424\u041E\u041F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (f.odb_id) throw fail(400, "\u0426\u0435\u0439 \u0424\u041E\u041F \u0434\u043E\u0434\u0430\u043D\u043E \u0437 Opendatabot \u2014 \u0432\u0438\u043C\u043A\u043D\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0443 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u0440\u0430\u0445\u0443\u043D\u043A\u0456\u0432\xBB.");
    await db.run(`DELETE FROM inv_fops WHERE id = ?`, [f.id]);
    return c.json({ ok: true });
  });
  app.get("/api/rahunok-order/:q", async (c) => {
    need(c, "docs.edit");
    const q = c.req.param("q").trim().replace(/^№\s*/, "");
    const s = await settings();
    const { rawOrder, productNames, demo, code, note } = await loadOrder(q, s);
    const o = normalizeOrder(rawOrder, productNames);
    const number = demo ? "demo" : o.shortId || (/^\d{1,8}$/.test(q) ? q : o.orderId);
    return c.json({
      number,
      crmCode: code || "",
      note: note || "",
      buyer: o.buyer,
      items: o.items.map((i) => ({ name: i.article ? `${i.name} [${i.article}]` : i.name, qty: i.qty, price: i.price }))
    });
  });
  async function buildRahunok(b, number) {
    const fop = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [b.fop_id]);
    if (!fop) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u0424\u041E\u041F, \u0432\u0456\u0434 \u044F\u043A\u043E\u0433\u043E \u0432\u0438\u0441\u0442\u0430\u0432\u043B\u044F\u0454\u0442\u044C\u0441\u044F \u0440\u0430\u0445\u0443\u043D\u043E\u043A.");
    const clientName = String(b.client?.name || "").trim();
    if (!clientName) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043D\u0430\u0437\u0432\u0443 \u043A\u043B\u0456\u0454\u043D\u0442\u0430.");
    const items = (b.items || []).map((i) => ({ name: String(i.name || "").trim(), qty: num(i.qty), price: round2(num(i.price)) })).filter((i) => i.name);
    if (!items.length) throw fail(400, "\u0414\u043E\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0442\u043E\u0432\u0430\u0440.");
    for (const i of items) {
      if (!(i.qty > 0)) throw fail(400, `\u041A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0434\u043B\u044F \xAB${i.name}\xBB \u043C\u0430\u0454 \u0431\u0443\u0442\u0438 \u0431\u0456\u043B\u044C\u0448\u043E\u044E \u0437\u0430 0.`);
      i.unit = "\u0448\u0442";
      i.sum = round2(i.qty * i.price);
    }
    const today2 = kyivDay();
    const { signature, stamp, ...fopRest } = fop;
    return {
      number: String(number),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : today2,
      source: b.source === "crm" ? "crm" : "manual",
      orderRef: String(b.order_ref || ""),
      fop: { ...fopRest, signature, stamp, warning_text: fop.warning_text || DEFAULT_WARNING },
      client: { name: clientName, edrpou: String(b.client?.edrpou || "").trim(), contract: String(b.client?.contract || "").trim() },
      items,
      total: round2(items.reduce((t, i) => t + i.sum, 0))
    };
  }
  app.get("/api/rahunky", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const rows = await db.all(
      `SELECT id, number, source, order_ref, fop_name, client_name, total, created_at, created_by, updated_at, updated_by,
         (SELECT p.status FROM pay_links p WHERE p.id = json_extract(invoices.data, '$.pay.link_id')) AS pay_status FROM invoices
       ${q ? "WHERE number LIKE ? OR client_name LIKE ? OR order_ref LIKE ?" : ""} ORDER BY id DESC LIMIT 300`,
      q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []
    );
    const s = await settings();
    return c.json({ rows, nextNumber: peekRahunokNumber(s), retentionDays: Number(s.retention_days) || 7 });
  });
  app.get("/api/rahunky/:id", async (c) => {
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param("id")]);
    if (!row) throw fail(404, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E (\u043C\u043E\u0436\u043B\u0438\u0432\u043E, \u043C\u0438\u043D\u0443\u0432 \u0441\u0442\u0440\u043E\u043A \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u043D\u043D\u044F).");
    return c.json({ ...row, data: JSON.parse(row.data) });
  });
  app.post("/api/rahunky", async (c) => {
    need(c, "docs.edit");
    const b = await c.req.json();
    let number = "";
    if (b.source === "crm") {
      number = String(b.number || "").trim();
      if (!number) throw fail(400, "\u041D\u0435\u043C\u0430\u0454 \u043D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F CRM.");
    }
    const data = await buildRahunok(b, number);
    if (b.source !== "crm") data.number = await takeRahunokNumber(db);
    if (b.qr) data.pay = await services.payments.linkForRahunok(c, data);
    const r = await db.run(
      `INSERT INTO invoices (number, source, order_ref, fop_id, fop_name, client_name, total, data, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.number, data.source, data.orderRef, data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c)]
    );
    return c.json({ id: r.lastId, data });
  });
  app.put("/api/rahunky/:id", async (c) => {
    need(c, "docs.edit");
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param("id")]);
    if (!row) throw fail(404, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const b = await c.req.json();
    const prev = JSON.parse(row.data);
    const data = await buildRahunok({ ...b, source: prev.source, order_ref: prev.orderRef }, row.number);
    if (b.qr) data.pay = await services.payments.linkForRahunok(c, data);
    await db.run(
      `UPDATE invoices SET fop_id = ?, fop_name = ?, client_name = ?, total = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c), row.id]
    );
    return c.json({ id: row.id, data });
  });
  app.delete("/api/rahunky/:id", async (c) => {
    need(c, "docs.edit");
    await db.run(`DELETE FROM invoices WHERE id = ?`, [c.req.param("id")]);
    return c.json({ ok: true });
  });
}

// src/modules/analytics/index.js
var toUtc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
var fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
var addDays = (day, n) => fromUtc(toUtc(day) + n * 864e5);
var daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 864e5) + 1;
var monthStart = (day) => `${day.slice(0, 7)}-01`;
var daysInMonth = (day) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0)).getUTCDate();
var monthEnd = (day) => `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, "0")}`;
function addMonths(day, n) {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return fromUtc(d.getTime());
}
var isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
var low = (v) => String(v ?? "").trim().toLowerCase();
var DELIV_PER_DAY = 15e3;
var DELIV_PER_RUN = 3e3;
var AN_DEFAULTS = {
  compare: true,
  deptPriority: "manager",
  targetBase: "net",
  months: 6,
  // «Оновити сьогодні»: не більше стількох разів на добу (0 — без ліміту) і не частіше, ніж раз на стільки хвилин.
  refreshPerDay: 10,
  refreshGapMin: 15,
  okStatuses: [11, 14, 53, 18],
  refuseStatuses: [54, 58]
};
async function loadMaps(db, st) {
  const [offices, managers, sources, brands, srcRows] = await Promise.all([
    db.all(`SELECT office, dept_id FROM an_office_map`),
    db.all(`SELECT login, dept_id, depts FROM an_managers`),
    db.all(`SELECT value, source_id FROM an_source_map`),
    db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`),
    db.all(`SELECT id, dept_id FROM an_sources`)
  ]);
  return {
    prio: st.deptPriority,
    office: new Map(offices.map((r) => [String(r.office), r.dept_id])),
    mgr: new Map(managers.filter((r) => r.dept_id).map((r) => [low(r.login), r.dept_id])),
    mgrSet: new Map(managers.filter((r) => r.dept_id && String(r.depts || "").includes(",")).map((r) => [low(r.login), new Set(String(r.depts).split(",").map(Number))])),
    srcDept: new Map(srcRows.map((r) => [r.id, r.dept_id])),
    src: new Map(sources.map((r) => [r.value, r.source_id])),
    brands: brands.map((b) => ({ id: b.id, kws: String(b.keywords || "").split(",").map(low).filter(Boolean) }))
  };
}
var mgrDept = (o, m, src) => {
  const set = m.mgrSet.get(o.user);
  if (set) {
    const sd = src ? m.srcDept.get(src) : null;
    if (sd && set.has(sd)) return sd;
    const od = m.office.get(o.office);
    if (od && set.has(od)) return od;
  }
  return m.mgr.get(o.user);
};
var deptOf = (o, m, src) => m.prio === "office" ? m.office.get(o.office) ?? mgrDept(o, m, src) ?? 0 : mgrDept(o, m, src) ?? m.office.get(o.office) ?? 0;
var srcOf = (o, m) => o.ch && m.src.get(o.ch) || o.site && m.src.get(o.site) || o.utm && m.src.get(o.utm) || 0;
function brandOf(name, brands) {
  const n = low(name);
  for (const b of brands) if (b.kws.some((k) => n.includes(k))) return b.id;
  return 0;
}
async function remap(db, st, { dept = true, src = true } = {}) {
  if (src) {
    const one = (col) => `CASE WHEN an_orders.${col} != '' THEN (SELECT source_id FROM an_source_map s WHERE s.value = an_orders.${col}) END`;
    const x = `COALESCE(${one("ch")}, ${one("site")}, ${one("utm")}, 0)`;
    await db.run(`UPDATE an_orders SET src = ${x} WHERE src IS NOT ${x}`);
  }
  if (dept || src) {
    const deptOff = `(SELECT dept_id FROM an_office_map f WHERE f.office = an_orders.office)`;
    const deptSrc = `(SELECT dept_id FROM an_sources s WHERE s.id = an_orders.src)`;
    const inSet = (x) => `(',' || m.depts || ',') LIKE ('%,' || ${x} || ',%')`;
    const deptMgr = `(SELECT CASE
        WHEN m.depts LIKE '%,%' AND ${deptSrc} IS NOT NULL AND ${inSet(deptSrc)} THEN ${deptSrc}
        WHEN m.depts LIKE '%,%' AND ${deptOff} IS NOT NULL AND ${inSet(deptOff)} THEN ${deptOff}
        ELSE m.dept_id END
      FROM an_managers m WHERE m.login = an_orders.user AND m.dept_id IS NOT NULL)`;
    const d = st.deptPriority === "office" ? `COALESCE(${deptOff}, ${deptMgr}, 0)` : `COALESCE(${deptMgr}, ${deptOff}, 0)`;
    const where = dept ? "" : ` AND user IN (SELECT login FROM an_managers WHERE depts LIKE '%,%')`;
    await db.run(`UPDATE an_orders SET dept = ${d} WHERE dept IS NOT ${d}${where}`);
  }
}
async function rebrand(db) {
  const brands = (await db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`)).map((b) => ({ id: b.id, kws: String(b.keywords || "").split(",").map(low).filter(Boolean) }));
  const prods = await db.all(`SELECT p.product_id, p.name, p.brand_id, p.brand_manual, c.name AS cat
    FROM an_products p LEFT JOIN an_categories c ON c.id = COALESCE(p.cat_manual, p.category_id)`);
  const upd = [];
  for (const p of prods) {
    const b = p.brand_manual != null ? p.brand_manual : brandOf(p.name, brands) || brandOf(p.cat || "", brands);
    if (b !== p.brand_id) upd.push([`UPDATE an_products SET brand_id = ? WHERE product_id = ?`, [b, p.product_id]]);
  }
  await db.batch(upd);
  return upd.length;
}
function normalizeAnOrder(raw2) {
  const id = parseInt(raw2.id, 10);
  const day = String(raw2.datetime || "").slice(0, 10);
  if (!id || !isDay(day)) return null;
  const lines = asList(raw2.products).slice(0, 99).map((p) => ({
    product_id: parseInt(p.product_id, 10) || 0,
    name: String(p.name || p.product_name || "").trim(),
    qty: num(p.quantity ?? p.count) || 0,
    price: num(p.price)
  }));
  const sumLines = lines.reduce((s, l) => s + l.qty * l.price, 0);
  let total = num(raw2.total);
  if (total <= 0 && sumLines > 0) total = sumLines;
  const k = sumLines > 0 ? total / sumLines : 0;
  for (const l of lines) l.amount = round2(l.qty * l.price * k);
  return {
    id,
    code: String(raw2.order_id || ""),
    day,
    status: parseInt(raw2.status, 10) || 0,
    office: String(raw2.office ?? ""),
    user: low(raw2.user),
    ch: low(raw2.additional_1),
    site: low(raw2.site),
    utm: low(raw2.utm_source),
    total: round2(total),
    deliv: delivName(raw2),
    ttn: ttnOf(raw2),
    lines
  };
}
var TTN_KEYS = ["ttn", "ttn_number", "np_ttn", "declaration", "tracking_number"];
function ttnOf(raw2) {
  for (const k of TTN_KEYS) {
    const v = String(raw2?.[k] ?? "").replace(/\s/g, "").toUpperCase();
    if (/^[0-9A-Z]{8,20}$/.test(v) && !/^0+$/.test(v)) return v;
  }
  return "";
}
function delivName(raw2) {
  const name = String(raw2.delivery_name ?? raw2.delivery ?? "").trim();
  if (name && !/^\d+$/.test(name)) return name.slice(0, 80);
  const id = String(raw2.delivery_id ?? (name || "")).trim();
  return id && id !== "0" ? `\u0441\u043B\u0443\u0436\u0431\u0430 \u2116${id}` : "";
}
var DELIV_GROUPS = [
  [/нов[аі]\s*(пошт|почт)|nova\s*po(st|sh)|^(нп|np)(?![a-zа-яіїєґ])/i, "\u041D\u043E\u0432\u0430 \u043F\u043E\u0448\u0442\u0430"],
  [/укр\s*(пошт|почт)|ukr\s*posh/i, "\u0423\u043A\u0440\u043F\u043E\u0448\u0442\u0430"],
  [/розетк|rozetka/i, "\u0420\u043E\u0437\u0435\u0442\u043A\u0430"],
  [/meest|міст\s*експрес|мист\s*экспресс|^міст(?![a-zа-яіїєґ])/i, "Meest"],
  [/самовив|самовыв|pickup|самостійн/i, "\u0421\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437"],
  [/justin|джастін/i, "Justin"],
  [/кур.?єр|курьер|courier|адресн/i, "\u041A\u0443\u0440\u2019\u0454\u0440"]
];
function delivGroup(name) {
  if (name == null) return "\u0429\u0435 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0443\u0454\u0442\u044C\u0441\u044F";
  if (!String(name).trim()) return "\u041D\u0435 \u0432\u043A\u0430\u0437\u0430\u043D\u043E";
  for (const [re, g] of DELIV_GROUPS) if (re.test(name)) return g;
  return String(name).trim();
}
async function saveOrders(db, orders, maps) {
  const st = [];
  const bounds = /* @__PURE__ */ new Map();
  for (const o of orders) {
    st.push([
      `INSERT INTO an_orders (id, code, day, status, office, user, ch, site, utm, total, dept, src, deliv, ttn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, day = excluded.day, status = excluded.status, office = excluded.office,
       user = excluded.user, ch = excluded.ch, site = excluded.site, utm = excluded.utm, total = excluded.total, dept = excluded.dept, src = excluded.src,
       deliv = excluded.deliv, ttn = excluded.ttn`,
      [o.id, o.code, o.day, o.status, o.office, o.user, o.ch, o.site, o.utm, o.total, deptOf(o, maps, srcOf(o, maps)), srcOf(o, maps), o.deliv ?? "", o.ttn || ""]
    ]);
    st.push([`DELETE FROM an_items WHERE id BETWEEN ? AND ?`, [o.id * 100, o.id * 100 + 99]]);
    o.lines.forEach((l, n) => {
      st.push([`INSERT INTO an_items (id, product_id, qty, amount) VALUES (?, ?, ?, ?)`, [o.id * 100 + n, l.product_id, l.qty, l.amount]]);
      if (l.product_id) {
        st.push([`INSERT OR IGNORE INTO an_products (product_id, name, brand_id) VALUES (?, ?, ?)`, [l.product_id, l.name, brandOf(l.name, maps.brands)]]);
      }
    });
    const b = bounds.get(o.day) || [o.id, o.id];
    bounds.set(o.day, [Math.min(b[0], o.id), Math.max(b[1], o.id)]);
  }
  for (const [day, [lo, hi]] of bounds) {
    st.push([
      `INSERT INTO an_day_bounds (day, min_id, max_id) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET min_id = MIN(min_id, excluded.min_id), max_id = MAX(max_id, excluded.max_id)
       WHERE excluded.min_id < an_day_bounds.min_id OR excluded.max_id > an_day_bounds.max_id`,
      [day, lo, hi]
    ]);
  }
  await db.batch(st);
}
async function idRange(db, from, to) {
  const r = await db.get(`SELECT MIN(min_id) AS lo, MAX(max_id) AS hi FROM an_day_bounds WHERE day BETWEEN ? AND ?`, [from, to]);
  return r && r.lo != null ? [r.lo, r.hi] : null;
}
function findProducts2(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return [];
  if (!Array.isArray(node) && "category_id" in node && ("id" in node || "product_id" in node)) return [node];
  return Object.values(node).flatMap((v) => findProducts2(v, depth + 1));
}
function flattenCategories(node, parent = null, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 10) return out;
  for (const c of Array.isArray(node) ? node : Object.values(node)) {
    if (!c || typeof c !== "object") continue;
    const id = parseInt(c.id, 10);
    if (id) out.push({ id, name: String(c.name || ""), parent_id: c.parent_id != null ? parseInt(c.parent_id, 10) || null : parent });
    if (c.subcategories) flattenCategories(c.subcategories, id || parent, out, depth + 1);
  }
  return out;
}
function mountAnalytics(app, { db, fetchFn, services = {}, shared: shared2 = {}, onTick = () => {
} }) {
  const settings = () => loadSettings(db);
  const getSt = async () => {
    const r = await db.get(`SELECT value FROM settings WHERE key = 'an_settings'`);
    let v = {};
    try {
      v = r?.value ? JSON.parse(r.value) : {};
    } catch {
    }
    return { ...AN_DEFAULTS, ...v };
  };
  const putSetting2 = (key, value) => db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  const getJson = async (key) => {
    const r = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
    try {
      return r?.value ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  };
  const creds = async () => {
    const s = await settings();
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, "\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u0432\u043A\u0430\u0436\u0456\u0442\u044C API-\u043A\u043B\u044E\u0447 \u0443 \u0437\u0430\u0433\u0430\u043B\u044C\u043D\u0438\u0445 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445.");
    return { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
  };
  const lp = (c, method, params) => call(fetchFn, c.subdomain, c.key, method, params);
  const bump = () => db.batch([
    [`INSERT INTO settings (key, value) VALUES ('an_ver', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(Date.now())]],
    [`DELETE FROM an_cache`, []]
  ]);
  async function computeValues() {
    const [ch, site, utm, users, offices, sold] = await Promise.all([
      db.all(`SELECT ch AS v, COUNT(*) AS n FROM an_orders WHERE ch != '' GROUP BY ch`),
      db.all(`SELECT site AS v, COUNT(*) AS n FROM an_orders WHERE site != '' GROUP BY site`),
      db.all(`SELECT utm AS v, COUNT(*) AS n FROM an_orders WHERE utm != '' GROUP BY utm`),
      db.all(`SELECT user AS v, COUNT(*) AS n FROM an_orders WHERE user != '' GROUP BY user ORDER BY n DESC`),
      db.all(`SELECT office AS v, COUNT(*) AS n FROM an_orders GROUP BY office ORDER BY n DESC`),
      db.all(`SELECT product_id AS id, SUM(qty) AS q FROM an_items GROUP BY product_id`)
    ]);
    const values = /* @__PURE__ */ new Map();
    for (const [field, rows] of [["\u041F\u043E\u043B\u0435 1", ch], ["\u0421\u0430\u0439\u0442", site], ["utm_source", utm]]) {
      for (const r of rows) {
        const cur = values.get(r.v) || { value: r.v, n: 0, fields: [] };
        cur.n += r.n;
        cur.fields.push(field);
        values.set(r.v, cur);
      }
    }
    const data = {
      at: nowIso(),
      values: [...values.values()].sort((a, b) => b.n - a.n),
      users,
      offices,
      sold: Object.fromEntries(sold.map((r) => [r.id, r.q]))
    };
    await putSetting2("an_values", JSON.stringify(data));
    return data;
  }
  async function mergeTodayValues(day) {
    const cur = await getJson("an_values");
    if (!cur) return computeValues();
    const r = await idRange(db, day, day);
    if (!r) return cur;
    const rows = await db.all(`SELECT ch, site, utm, user, office FROM an_orders WHERE id BETWEEN ? AND ? AND day = ?`, [r[0], r[1], day]);
    const has = (list, v, key = "v") => list.some((x) => x[key] === v);
    for (const o of rows) {
      for (const [field, v] of [["\u041F\u043E\u043B\u0435 1", o.ch], ["\u0421\u0430\u0439\u0442", o.site], ["utm_source", o.utm]]) {
        if (v && !has(cur.values, v, "value")) cur.values.push({ value: v, n: 1, fields: [field] });
      }
      if (o.user && !has(cur.users, o.user)) cur.users.push({ v: o.user, n: 1 });
      if (o.office && !has(cur.offices, o.office)) cur.offices.push({ v: o.office, n: 1 });
    }
    await putSetting2("an_values", JSON.stringify(cur));
    return cur;
  }
  const OWN_ALLOWED = /* @__PURE__ */ new Set(["POST /api/an/query", "GET /api/an/sync", "POST /api/an/sync/start", "POST /api/an/sync/step"]);
  app.use("/api/an/*", async (c, next) => {
    const user = c.get("user");
    if (!can(user, "analytics")) {
      need(c, "an.view");
      if (!OWN_ALLOWED.has(`${c.req.method} ${c.req.path}`)) throw fail(403, "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u0446\u0456\u0454\u0457 \u0434\u0456\u0457.");
      c.set("anOwn", crmLogins(user.crm_logins));
    }
    if (!shared2.anRemapChecked) {
      shared2.anRemapChecked = true;
      const f = await db.get(`SELECT value FROM settings WHERE key = 'an_need_remap'`);
      if (f?.value === "1") {
        await remap(db, await getSt());
        await rebrand(db);
        await db.run(`UPDATE settings SET value = '0' WHERE key = 'an_need_remap'`);
        await bump();
      }
    }
    return next();
  });
  async function checkTtnDups(orders, { firstRun = false } = {}) {
    const ttns = [...new Set(orders.map((o) => o.ttn).filter(Boolean))];
    if (!ttns.length) return 0;
    const seenBefore = (await db.get(`SELECT value FROM settings WHERE key = 'an_ttn_seen'`))?.value || "";
    const silent = firstRun || !seenBefore;
    if (!seenBefore || seenBefore.slice(0, 13) !== nowIso().slice(0, 13)) await putSetting2("an_ttn_seen", nowIso());
    const rows = await db.all(`SELECT code, user, ttn, status, day FROM an_orders WHERE ttn IN (SELECT value FROM json_each(?)) AND status != 0 ORDER BY id`, [JSON.stringify(ttns)]);
    return notifyDups(rows, { silent, recentDays: 14 });
  }
  async function notifyDups(rows, { silent = false, recentDays = 14 } = {}) {
    const by = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!by.has(r.ttn)) by.set(r.ttn, []);
      by.get(r.ttn).push(r);
    }
    const dups = [...by].filter(([, list]) => new Set(list.map((r) => r.code)).size > 1);
    if (!dups.length) return 0;
    const sent = new Map((await db.all(`SELECT ttn, codes FROM an_ttn_dups WHERE ttn IN (SELECT value FROM json_each(?))`, [JSON.stringify(dups.map(([t]) => t))])).map((r) => [r.ttn, r.codes]));
    const names = await getJson("an_status_names") || {};
    const users = await db.all(`SELECT tg_chat_id, crm_logins FROM users WHERE active = 1 AND tg_chat_id != '' AND crm_logins != ''`);
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let n = 0;
    const recent = addDays(kyivDay(), -recentDays);
    for (const [ttn, list] of dups) {
      const codes = [...new Set(list.map((r) => r.code))].sort().join(",");
      if (sent.get(ttn) === codes) continue;
      if (silent || n >= 5 || !list.some((r) => r.day >= recent)) {
        await db.run(`INSERT INTO an_ttn_dups (ttn, codes, at) VALUES (?, ?, ?) ON CONFLICT(ttn) DO UPDATE SET codes = excluded.codes, at = excluded.at`, [ttn, codes, nowIso()]);
        continue;
      }
      const text = `\u26A0\uFE0F <b>\u0414\u0443\u0431\u043B\u044C \u0422\u0422\u041D ${esc(ttn)}</b> \u0443 LP-CRM \u2014 \u0446\u044F \u0422\u0422\u041D \u0454 \u0432 ${list.length} \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F\u0445:
` + list.map((r) => `\u2022 \u2116 <b>${esc(r.code)}</b> \xB7 ${esc(names[r.status] || `\u0441\u0442\u0430\u0442\u0443\u0441 ${r.status}`)} \xB7 ${esc(r.day.split("-").reverse().join("."))}${r.user ? ` \xB7 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 ${esc(r.user)}` : ""}`).join("\n") + "\n\n\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435, \u0447\u0438 \u043D\u0435 \u043F\u043E\u043C\u0438\u043B\u043A\u0430 (\u043E\u0434\u043D\u0430 \u043F\u043E\u0441\u0438\u043B\u043A\u0430 \u043D\u0430 \u0434\u0432\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F).";
      const logins = new Set(list.map((r) => r.user).filter(Boolean));
      const chats = users.filter((u) => crmLogins(u.crm_logins).some((l) => logins.has(l))).map((u) => u.tg_chat_id);
      if (chats.length) await services.notify?.sendText({ chatIds: chats }, text).catch(() => 0);
      else await services.notify?.sendText({ admins: true }, text).catch(() => 0);
      await db.run(`INSERT INTO an_ttn_dups (ttn, codes, at) VALUES (?, ?, ?) ON CONFLICT(ttn) DO UPDATE SET codes = excluded.codes, at = excluded.at`, [ttn, codes, nowIso()]);
      n++;
    }
    return n;
  }
  const TTN_EVERY = 10 * 6e4;
  async function ttnQuick({ force = false } = {}) {
    const now = Date.now();
    if (!force) {
      const claim = await db.run(
        `INSERT INTO settings (key, value) VALUES ('an_ttn_check_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
        [new Date(now).toISOString(), new Date(now - TTN_EVERY + 3e4).toISOString()]
      );
      if (!claim.changes) return { skipped: true };
    } else await putSetting2("an_ttn_check_at", new Date(now).toISOString());
    const s = await settings();
    if (!s.lpcrm_subdomain || !s.lpcrm_key) return { skipped: true, reason: "LP-CRM \u043D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E" };
    const cr = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    const st = await getSt();
    const today2 = kyivDay();
    const from = addDays(today2, -1);
    const listed = /* @__PURE__ */ new Map();
    for (const x of [...st.okStatuses, ...st.refuseStatuses]) {
      const j = await lp(cr, "getOrdersIdByStatus", { status: String(x), date_start: from, date_end: today2 }).catch(() => null);
      if (j?.status === "ok") for (const code of asList(j.data).map(String).filter(Boolean)) listed.set(code, x);
    }
    const codes = [...listed.keys()];
    let fetched = 0;
    let found = 0;
    if (codes.length) {
      const known = new Map((await db.all(`SELECT code, status FROM an_ttn_recent WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(codes)])).map((r) => [r.code, r.status]));
      const todo = codes.filter((x) => known.get(x) !== listed.get(x)).slice(0, 300);
      const got = [];
      for (let i = 0; i < todo.length; i += 100) {
        const j = await lp(cr, "getOrdersByID", { order_id: todo.slice(i, i + 100).join(",") }).catch(() => null);
        if (j?.status === "ok") got.push(...findOrders(j.data).map(normalizeAnOrder).filter(Boolean));
      }
      fetched = got.length;
      if (got.length) {
        await db.batch(got.map((o) => [`INSERT INTO an_ttn_recent (code, ttn, day, user, status) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET ttn = excluded.ttn, day = excluded.day, user = excluded.user, status = excluded.status`, [o.code, o.ttn || "", o.day, o.user, o.status]]));
        const ttns = [...new Set(got.map((o) => o.ttn).filter(Boolean))];
        if (ttns.length) {
          const week = addDays(today2, -7);
          const [a, b] = await Promise.all([
            db.all(`SELECT code, user, ttn, status, day FROM an_ttn_recent WHERE ttn IN (SELECT value FROM json_each(?)) AND day >= ?`, [JSON.stringify(ttns), week]),
            db.all(`SELECT code, user, ttn, status, day FROM an_orders WHERE ttn IN (SELECT value FROM json_each(?)) AND status != 0 AND day >= ?`, [JSON.stringify(ttns), week])
          ]);
          const seen = new Set(a.map((r) => r.code));
          found = await notifyDups([...a, ...b.filter((r) => !seen.has(r.code))], { recentDays: 7 });
        }
      }
    }
    const pruneDay = (await db.get(`SELECT value FROM settings WHERE key = 'an_ttn_prune'`))?.value || "";
    if (pruneDay !== today2) {
      await db.run(`DELETE FROM an_ttn_recent WHERE day < ?`, [addDays(today2, -10)]);
      await putSetting2("an_ttn_prune", today2);
    }
    const res = { at: new Date(now).toISOString(), listed: codes.length, fetched, dups: found };
    await putSetting2("an_ttn_last", JSON.stringify(res));
    return res;
  }
  onTick((c) => {
    if (Date.now() - (shared2.ttnTry || 0) < 6e4) return;
    shared2.ttnTry = Date.now();
    const p = (async () => {
      const last = (await db.get(`SELECT value FROM settings WHERE key = 'an_ttn_check_at'`))?.value || "";
      if (last && Date.now() - Date.parse(last) < TTN_EVERY) return;
      if (!(await db.get(`SELECT value FROM settings WHERE key = 'an_ttn_seen'`))?.value) return;
      await ttnQuick();
    })().catch(() => 0);
    try {
      c?.executionCtx?.waitUntil(p);
    } catch {
    }
  });
  app.post("/api/cron/ttn", async (c) => {
    const key = (await db.get(`SELECT value FROM settings WHERE key = 'an_cron_key'`))?.value || "";
    const got = c.req.header("x-cron-key") || "";
    if (!key || got.length !== key.length || got !== key) throw fail(401, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043A\u043B\u044E\u0447.");
    return c.json(await ttnQuick());
  });
  app.post("/api/an/ttn-check", async (c) => {
    if (!can(c.get("user"), "analytics")) throw fail(403, "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043F\u0440\u0430\u0432.");
    return c.json(await ttnQuick({ force: true }));
  });
  app.get("/api/an/cron-key", async (c) => {
    need(c, "users");
    return c.json({ key: (await db.get(`SELECT value FROM settings WHERE key = 'an_cron_key'`))?.value || "" });
  });
  app.post("/api/an/cron-key", async (c) => {
    need(c, "users");
    const key = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    await putSetting2("an_cron_key", key);
    return c.json({ key });
  });
  app.get("/api/an/config", async (c) => {
    const [st, depts, sources, smap, officeMap, managers, brands, offices, statusNames, lastSync, sync, categories] = await Promise.all([
      getSt(),
      db.all(`SELECT id, name, sort FROM an_depts ORDER BY sort, id`),
      db.all(`SELECT id, dept_id, name, sort FROM an_sources ORDER BY sort, id`),
      db.all(`SELECT value, source_id FROM an_source_map ORDER BY value`),
      db.all(`SELECT office, dept_id FROM an_office_map`),
      db.all(`SELECT login, name, dept_id, depts FROM an_managers ORDER BY name, login`),
      db.all(`SELECT id, name, keywords, sort FROM an_brands ORDER BY sort, id`),
      db.all(`SELECT office_id, name FROM offices ORDER BY CAST(office_id AS INTEGER)`),
      getJson("an_status_names"),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`),
      getJson("an_sync"),
      db.all(`SELECT id, name, parent_id FROM an_categories ORDER BY name`)
    ]);
    const ttnSeen = (await db.get(`SELECT value FROM settings WHERE key = 'an_ttn_seen'`))?.value || "";
    const ttnLast = await getJson("an_ttn_last");
    const cronOn = Boolean((await db.get(`SELECT value FROM settings WHERE key = 'an_cron_key'`))?.value);
    return c.json({
      categories,
      settings: st,
      depts: depts.map((d) => ({
        ...d,
        sources: sources.filter((s) => s.dept_id === d.id).map((s) => ({ ...s, values: smap.filter((m) => m.source_id === s.id).map((m) => m.value) }))
      })),
      officeMap,
      managers,
      brands,
      offices,
      statusNames: statusNames || {},
      lastSync: lastSync?.value || "",
      ttnSeen,
      ttnLast,
      cronOn,
      sync: sync ? { phase: sync.phase, startedAt: sync.startedAt, mode: sync.mode, error: sync.error || "" } : null
    });
  });
  app.get("/api/an/values", async (c) => {
    const v = await getJson("an_values") || await computeValues();
    return c.json({ values: v.values, users: v.users, offices: v.offices, at: v.at });
  });
  const ignored = async () => ({ users: [], values: [], offices: [], ...await getJson("an_ignored") || {} });
  app.get("/api/an/attention", async (c) => {
    const [v0, ig, smap, mgrs, omap, prod] = await Promise.all([
      getJson("an_values"),
      ignored(),
      db.all(`SELECT value FROM an_source_map`),
      db.all(`SELECT login FROM an_managers`),
      db.all(`SELECT office FROM an_office_map`),
      db.get(`SELECT SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN brand_id = 0 AND brand_manual IS NULL THEN 1 ELSE 0 END) AS nobrand,
        SUM(CASE WHEN COALESCE(cat_manual, category_id, 0) = 0 AND cat_manual IS NULL THEN 1 ELSE 0 END) AS nocat
        FROM an_products`)
    ]);
    const vals = v0 || await computeValues();
    const mapped = new Set(smap.map((r) => r.value));
    const known = new Set(mgrs.map((r) => r.login));
    const offs = new Set(omap.map((r) => String(r.office)));
    const out = {
      values: vals.values.filter((x) => !mapped.has(x.value) && !ig.values.includes(x.value)),
      users: vals.users.filter((x) => !known.has(x.v) && !ig.users.includes(x.v)),
      offices: vals.offices.filter((x) => x.v !== "" && !offs.has(String(x.v)) && !ig.offices.includes(String(x.v))),
      products: { fresh: prod?.fresh || 0, nobrand: prod?.nobrand || 0, nocat: prod?.nocat || 0 },
      ignored: ig
    };
    out.total = out.values.length + out.users.length + out.offices.length + out.products.fresh + out.products.nobrand + out.products.nocat;
    return c.json(out);
  });
  app.put("/api/an/ignore", async (c) => {
    const b = await c.req.json();
    if (!["users", "values", "offices"].includes(b.kind)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0438\u0439 \u0442\u0438\u043F.");
    const ig = await ignored();
    const v = String(b.value ?? "");
    ig[b.kind] = b.on ? [.../* @__PURE__ */ new Set([...ig[b.kind], v])] : ig[b.kind].filter((x) => x !== v);
    await putSetting2("an_ignored", JSON.stringify(ig));
    return c.json({ ok: true, ignored: ig });
  });
  app.get("/api/an/products", async (c) => {
    const [rows, cats, v] = await Promise.all([
      db.all(`SELECT product_id AS id, name, category_id, cat_manual, brand_id, brand_manual, seen FROM an_products ORDER BY seen, name`),
      db.all(`SELECT id, name, parent_id FROM an_categories ORDER BY name`),
      getJson("an_values")
    ]);
    const sold = v?.sold || {};
    return c.json({ products: rows.map((r) => ({ ...r, sold: sold[r.id] || 0 })), categories: cats });
  });
  app.put("/api/an/products", async (c) => {
    const list = await c.req.json();
    const norm = (x) => x === "" || x == null ? null : parseInt(x, 10);
    const st = (Array.isArray(list) ? list : []).filter((r) => parseInt(r.id, 10)).map((r) => [
      `UPDATE an_products SET brand_manual = ?, cat_manual = ?, seen = 1 WHERE product_id = ?`,
      [norm(r.brand_manual), norm(r.cat_manual), parseInt(r.id, 10)]
    ]);
    await db.batch(st);
    const changed = await rebrand(db);
    await bump();
    return c.json({ ok: true, changed });
  });
  app.post("/api/an/products/seen", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => parseInt(x, 10)).filter(Boolean);
    if (ids.length) await db.run(`UPDATE an_products SET seen = 1 WHERE product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
    else await db.run(`UPDATE an_products SET seen = 1 WHERE seen = 0`);
    return c.json({ ok: true });
  });
  app.put("/api/an/settings", async (c) => {
    const b = await c.req.json();
    const cur = await getSt();
    const next = { ...cur };
    if (b.compare !== void 0) next.compare = Boolean(b.compare);
    if (["manager", "office"].includes(b.deptPriority)) next.deptPriority = b.deptPriority;
    if (["net", "all"].includes(b.targetBase)) next.targetBase = b.targetBase;
    if (b.months !== void 0) next.months = Math.min(18, Math.max(1, parseInt(b.months, 10) || 6));
    const isOwner = c.get("user")?.role === "owner";
    if (isOwner && b.refreshPerDay !== void 0) next.refreshPerDay = Math.min(200, Math.max(0, parseInt(b.refreshPerDay, 10) || 0));
    if (isOwner && b.refreshGapMin !== void 0) next.refreshGapMin = Math.min(720, Math.max(0, parseInt(b.refreshGapMin, 10) || 0));
    await putSetting2("an_settings", JSON.stringify(next));
    if (next.deptPriority !== cur.deptPriority) await remap(db, next, { src: false });
    const dataKeys = ["compare", "deptPriority", "targetBase", "months"];
    if (dataKeys.some((k) => next[k] !== cur[k])) await bump();
    return c.json({ ok: true, settings: next });
  });
  app.put("/api/an/structure", async (c) => {
    const b = await c.req.json();
    const list = Array.isArray(b.depts) ? b.depts : [];
    const oldDepts = await db.all(`SELECT id FROM an_depts`);
    const oldSources = await db.all(`SELECT id FROM an_sources`);
    const keepD = /* @__PURE__ */ new Set();
    const keepS = /* @__PURE__ */ new Set();
    const st = [];
    const seenValues = /* @__PURE__ */ new Set();
    let di = 0;
    for (const d of list) {
      const name = String(d.name || "").trim();
      if (!name) continue;
      let id = parseInt(d.id, 10) || 0;
      if (id && oldDepts.some((x) => x.id === id)) {
        await db.run(`UPDATE an_depts SET name = ?, sort = ? WHERE id = ?`, [name, di, id]);
      } else {
        id = (await db.run(`INSERT INTO an_depts (name, sort) VALUES (?, ?)`, [name, di])).lastId;
      }
      di++;
      keepD.add(id);
      let si = 0;
      for (const s of d.sources || []) {
        const sname = String(s.name || "").trim();
        if (!sname) continue;
        let sid = parseInt(s.id, 10) || 0;
        if (sid && oldSources.some((x) => x.id === sid)) {
          await db.run(`UPDATE an_sources SET name = ?, dept_id = ?, sort = ? WHERE id = ?`, [sname, id, si, sid]);
        } else {
          sid = (await db.run(`INSERT INTO an_sources (dept_id, name, sort) VALUES (?, ?, ?)`, [id, sname, si])).lastId;
        }
        si++;
        keepS.add(sid);
        for (const v of s.values || []) {
          const val = low(v);
          if (!val || seenValues.has(val)) continue;
          seenValues.add(val);
          st.push([`INSERT INTO an_source_map (value, source_id) VALUES (?, ?)`, [val, sid]]);
        }
      }
    }
    const goneD = oldDepts.map((x) => x.id).filter((id) => !keepD.has(id));
    const goneS = oldSources.map((x) => x.id).filter((id) => !keepS.has(id));
    const del = [[`DELETE FROM an_source_map`, []]];
    for (const id of goneD) {
      del.push([`DELETE FROM an_depts WHERE id = ?`, [id]]);
      del.push([`DELETE FROM an_targets WHERE kind = 'dept' AND ref_id = ?`, [id]]);
      del.push([`UPDATE an_office_map SET dept_id = NULL WHERE dept_id = ?`, [id]]);
      del.push([`UPDATE an_managers SET dept_id = NULL, depts = '' WHERE dept_id = ?`, [id]]);
      del.push([`UPDATE an_managers SET depts = TRIM(REPLACE(',' || depts || ',', ',' || ? || ',', ','), ',') WHERE depts LIKE '%,%'`, [id]]);
    }
    for (const id of goneS) {
      del.push([`DELETE FROM an_sources WHERE id = ?`, [id]]);
      del.push([`DELETE FROM an_targets WHERE kind = 'src' AND ref_id = ?`, [id]]);
    }
    await db.batch([...del, ...st]);
    await remap(db, await getSt());
    await bump();
    return c.json({ ok: true });
  });
  app.put("/api/an/office-map", async (c) => {
    const list = await c.req.json();
    const st = [[`DELETE FROM an_office_map`, []]];
    for (const r of Array.isArray(list) ? list : []) {
      if (!String(r.office ?? "").trim() || !r.dept_id) continue;
      st.push([`INSERT OR REPLACE INTO an_office_map (office, dept_id) VALUES (?, ?)`, [String(r.office).trim(), parseInt(r.dept_id, 10)]]);
    }
    await db.batch(st);
    await remap(db, await getSt(), { src: false });
    await bump();
    return c.json({ ok: true });
  });
  app.put("/api/an/managers", async (c) => {
    const list = await c.req.json();
    const st = [[`DELETE FROM an_managers`, []]];
    for (const r of Array.isArray(list) ? list : []) {
      const login = low(r.login);
      if (!login) continue;
      const main = parseInt(r.dept_id, 10) || null;
      const all = main ? [.../* @__PURE__ */ new Set([main, ...(Array.isArray(r.depts) ? r.depts : String(r.depts || "").split(",")).map((x) => parseInt(x, 10)).filter(Boolean)])] : [];
      st.push([`INSERT OR REPLACE INTO an_managers (login, name, dept_id, depts) VALUES (?, ?, ?, ?)`, [login, String(r.name || "").trim(), main, all.join(",")]]);
    }
    await db.batch(st);
    await remap(db, await getSt(), { src: false });
    await bump();
    return c.json({ ok: true });
  });
  app.put("/api/an/brands", async (c) => {
    const list = await c.req.json();
    const old = await db.all(`SELECT id FROM an_brands`);
    const keep = /* @__PURE__ */ new Set();
    let i = 0;
    for (const r of Array.isArray(list) ? list : []) {
      const name = String(r.name || "").trim();
      if (!name) continue;
      const kws = String(r.keywords || name).split(",").map(low).filter(Boolean).join(", ");
      let id = parseInt(r.id, 10) || 0;
      if (id && old.some((x) => x.id === id)) await db.run(`UPDATE an_brands SET name = ?, keywords = ?, sort = ? WHERE id = ?`, [name, kws, i, id]);
      else id = (await db.run(`INSERT INTO an_brands (name, keywords, sort) VALUES (?, ?, ?)`, [name, kws, i])).lastId;
      keep.add(id);
      i++;
    }
    await db.batch(old.filter((x) => !keep.has(x.id)).map((x) => [`DELETE FROM an_brands WHERE id = ?`, [x.id]]));
    const changed = await rebrand(db);
    await bump();
    return c.json({ ok: true, changed });
  });
  app.get("/api/an/targets", async (c) => {
    const month = String(c.req.query("month") || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043C\u0456\u0441\u044F\u0446\u044C.");
    return c.json({ month, rows: await db.all(`SELECT kind, ref_id, amount FROM an_targets WHERE month = ?`, [month]) });
  });
  app.put("/api/an/targets", async (c) => {
    const b = await c.req.json();
    const month = String(b.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043C\u0456\u0441\u044F\u0446\u044C.");
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => ["dept", "src"].includes(r.kind) && parseInt(r.ref_id, 10) && num(r.amount) > 0).map((r) => [r.kind, parseInt(r.ref_id, 10), round2(num(r.amount))]);
    const copy = Math.min(12, Math.max(0, parseInt(b.copyMonths, 10) || 0));
    const st = [];
    for (let k = 0; k <= copy; k++) {
      const m = addMonths(`${month}-01`, k).slice(0, 7);
      st.push([`DELETE FROM an_targets WHERE month = ?`, [m]]);
      for (const [kind, ref, amount] of rows) st.push([`INSERT INTO an_targets (month, kind, ref_id, amount) VALUES (?, ?, ?, ?)`, [m, kind, ref, amount]]);
    }
    await db.batch(st);
    await bump();
    return c.json({ ok: true });
  });
  app.get("/api/an/sync", async (c) => {
    const [state, last, daily] = await Promise.all([
      getJson("an_sync"),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_daily'`)
    ]);
    const lastDaily = daily?.value || "";
    const running = state && state.phase !== "done" && !state.error;
    const dailyDue = !running && !!last?.value && (!lastDaily || Date.now() - Date.parse(lastDaily) > 20 * 36e5);
    return c.json({ state: state ? summary(state) : null, lastSync: last?.value || "", lastDaily, dailyDue, refresh: await refreshInfo(await getSt(), last?.value) });
  });
  async function refreshInfo(st, lastSync) {
    const perDay = Number(st.refreshPerDay ?? AN_DEFAULTS.refreshPerDay) || 0;
    const gapMin = Number(st.refreshGapMin ?? AN_DEFAULTS.refreshGapMin) || 0;
    const cnt = await getJson("an_today_cnt");
    const used = cnt?.day === kyivDay() ? cnt.n || 0 : 0;
    const nextAt = gapMin && lastSync ? new Date(Date.parse(lastSync) + gapMin * 6e4).toISOString() : "";
    return { perDay, gapMin, used, left: perDay ? Math.max(0, perDay - used) : null, nextAt: nextAt && Date.parse(nextAt) > Date.now() ? nextAt : "" };
  }
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
  function summary(s) {
    const left = s.units?.length || 0;
    const total = s.unitsTotal || 1;
    let pct2 = s.phase === "units" ? Math.round((total - left) / total * 90) : s.phase === "done" ? 100 : 95;
    if (pct2 < 1) pct2 = 1;
    const u = s.units?.[0];
    const status = u ? s.statusNames?.[u.s] || `\u0441\u0442\u0430\u0442\u0443\u0441 ${u.s}` : "";
    const text = s.phase === "units" && u ? `${u.from.slice(0, 7)} \xB7 ${status}` : s.phase === "units" && s.pending?.length ? `\u0414\u043E\u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F ${s.pending.length} \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C` : s.phase === "deliv" ? "\u0421\u043B\u0443\u0436\u0431\u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 (\u0434\u043E\u0437\u0430\u043F\u043E\u0432\u043D\u0435\u043D\u043D\u044F \u0456\u0441\u0442\u043E\u0440\u0456\u0457)" : s.phase === "products" ? "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457 \u0442\u043E\u0432\u0430\u0440\u0456\u0432" : s.phase === "categories" ? "\u0414\u043E\u0432\u0456\u0434\u043D\u0438\u043A \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0439" : s.phase === "cleanup" ? "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044F" : "\u0413\u043E\u0442\u043E\u0432\u043E";
    return {
      mode: s.mode,
      phase: s.phase,
      done: s.phase === "done",
      pct: pct2,
      text,
      stats: s.stats,
      warnings: s.warnings || [],
      error: s.error || "",
      startedAt: s.startedAt
    };
  }
  app.post("/api/an/sync/start", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const mode = ["today", "full", "reset"].includes(b.mode) ? b.mode : "daily";
    if (c.get("anOwn") && mode !== "daily") throw fail(403, "\u041E\u043D\u043E\u0432\u043B\u044E\u0432\u0430\u0442\u0438 \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0443 \u0432\u0440\u0443\u0447\u043D\u0443 \u043C\u043E\u0436\u0443\u0442\u044C \u043B\u0438\u0448\u0435 \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0438.");
    const cur = await getJson("an_sync");
    if (cur && cur.phase !== "done" && !cur.error && !b.force) return c.json({ state: summary(cur), already: true });
    if (c.get("anOwn")) {
      const lastDaily = (await db.get(`SELECT value FROM settings WHERE key = 'an_last_daily'`))?.value || "";
      if (lastDaily && Date.now() - Date.parse(lastDaily) <= 20 * 36e5) throw fail(429, `\u0410\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430 \u043E\u043D\u043E\u0432\u043B\u044E\u0454\u0442\u044C\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E \u0440\u0430\u0437 \u043D\u0430 \u0434\u043E\u0431\u0443; \u043E\u0441\u0442\u0430\u043D\u043D\u0454 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u2014 ${hhmm(lastDaily)}.`);
    }
    const st = await getSt();
    if (mode === "today") {
      const last = (await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`))?.value || "";
      const r = await refreshInfo(st, last);
      if (r.perDay && r.used >= r.perDay) {
        throw fail(429, `\u041B\u0456\u043C\u0456\u0442 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u044C \u043D\u0430 \u0441\u044C\u043E\u0433\u043E\u0434\u043D\u0456 \u0432\u0438\u0447\u0435\u0440\u043F\u0430\u043D\u043E (${r.perDay}). \u0414\u0430\u043D\u0456 \u0437\u0430 30 \u0434\u043D\u0456\u0432 \u043E\u043D\u043E\u0432\u043B\u044F\u0442\u044C\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E \u0437\u0430\u0432\u0442\u0440\u0430; \u043B\u0456\u043C\u0456\u0442 \u0437\u0430\u0434\u0430\u0454 \u0432\u043B\u0430\u0441\u043D\u0438\u043A \u0443 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0438.`);
      }
      if (r.nextAt) throw fail(429, `\u0414\u0430\u043D\u0456 \u043E\u043D\u043E\u0432\u043B\u044E\u0432\u0430\u043B\u0438\u0441\u044C \u043E ${hhmm(last)} \u2014 \u043D\u0430\u0441\u0442\u0443\u043F\u043D\u0435 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043C\u043E\u0436\u043D\u0430 \u043E ${hhmm(r.nextAt)}.`);
      await putSetting2("an_today_cnt", JSON.stringify({ day: kyivDay(), n: r.used + 1 }));
    }
    const cr = await creds();
    const statusNames = await lp(cr, "getStatuses", {}).then((j) => j.status === "ok" ? j.data || {} : {}).catch(() => ({}));
    if (Object.keys(statusNames).length) await putSetting2("an_status_names", JSON.stringify(statusNames));
    if (mode === "reset") {
      await db.batch([[`DELETE FROM an_items`, []], [`DELETE FROM an_orders`, []], [`DELETE FROM an_day_bounds`, []], [`UPDATE an_products SET fetched = 0`, []]]);
    }
    const firstRun = !(await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`))?.value;
    const today2 = kyivDay();
    const keepFrom = addMonths(monthStart(today2), -st.months);
    const start = mode === "today" || mode === "daily" ? addDays(today2, -29) : keepFrom;
    const statuses = [...st.okStatuses, ...st.refuseStatuses];
    const units = [];
    for (let m = monthStart(today2); m >= monthStart(start); m = addMonths(m, -1)) {
      const to = monthEnd(m) > today2 ? today2 : monthEnd(m);
      const from = m < start ? start : m;
      for (const s of statuses) units.push({ s, from, to });
    }
    const state = {
      mode,
      startedAt: nowIso(),
      start,
      keepFrom,
      firstRun,
      today: today2,
      // Повні дані (сума, товари, менеджер) наново — лише для сьогоднішніх замовлень; решта — лише нові
      // і ті, у яких змінився статус (щоденне оновлення більше не перечитує весь тиждень).
      refetchFrom: mode === "today" || mode === "daily" ? today2 : "9999-12-31",
      phase: "units",
      units,
      unitsTotal: units.length,
      pending: [],
      statusNames,
      stats: { listed: 0, fetched: 0, changed: 0, products: 0 },
      warnings: []
    };
    await putSetting2("an_sync", JSON.stringify(state));
    return c.json({ state: summary(state) });
  });
  app.post("/api/an/sync/step", async (c) => {
    const state = await getJson("an_sync");
    if (!state) return c.json({ state: null });
    if (state.phase === "done" || state.error) return c.json({ state: summary(state) });
    if (state.lockUntil && state.lockUntil > Date.now()) return c.json({ state: summary(state), busy: true });
    state.lockUntil = Date.now() + 12e4;
    await putSetting2("an_sync", JSON.stringify(state));
    const st = await getSt();
    const cr = await creds();
    const maps = await loadMaps(db, st);
    const MAX_CALLS = 5;
    const started = Date.now();
    let calls = 0;
    const warn = (w) => {
      if (!state.warnings.includes(w) && state.warnings.length < 10) state.warnings.push(w);
    };
    const save = () => putSetting2("an_sync", JSON.stringify(state));
    try {
      while (calls < MAX_CALLS && Date.now() - started < 25e3 && state.phase !== "done") {
        if (state.phase === "units" && state.units.length && state.pending.length < 100) {
          const u = state.units[0];
          {
            const j = await lp(cr, "getOrdersIdByStatus", { status: String(u.s), date_start: u.from, date_end: u.to });
            calls++;
            const codes = j.status === "ok" ? asList(j.data).map(String).filter(Boolean) : [];
            if (j.status !== "ok" && j.message && !/не знайден|нет|not found|відсутн/i.test(String(j.message))) warn(`LP-CRM: ${j.message}`);
            if (codes.length >= 300 && u.from < u.to) {
              const mid = addDays(u.from, Math.floor(daysBetween(u.from, u.to) / 2) - 1);
              state.units.splice(0, 1, { s: u.s, from: u.from, to: mid }, { s: u.s, from: addDays(mid, 1), to: u.to });
              state.unitsTotal += 1;
              continue;
            }
            state.stats.listed += codes.length;
            const listed = new Set(codes);
            const known = /* @__PURE__ */ new Map();
            const range = await idRange(db, u.from, u.to);
            const upd = [];
            if (range) {
              const rows = await db.all(
                `SELECT id, code, day FROM an_orders WHERE id BETWEEN ? AND ? AND day BETWEEN ? AND ? AND status = ?`,
                [range[0], range[1], u.from, u.to, u.s]
              );
              for (const r of rows) {
                if (listed.has(r.code)) known.set(r.code, r);
                else upd.push([`UPDATE an_orders SET status = 0 WHERE id = ?`, [r.id]]);
              }
            }
            const rest = codes.filter((x) => !known.has(x));
            const changedStatus = /* @__PURE__ */ new Set();
            if (rest.length) {
              const rows = await db.all(`SELECT id, code, day, status FROM an_orders WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(rest)]);
              for (const r of rows) {
                known.set(r.code, r);
                if (r.status !== u.s) {
                  upd.push([`UPDATE an_orders SET status = ? WHERE id = ?`, [u.s, r.id]]);
                  changedStatus.add(r.code);
                }
              }
            }
            state.stats.changed += upd.length;
            await db.batch(upd);
            const queued = new Set(state.pending);
            state.pending.push(...codes.filter((x) => !queued.has(x) && (!known.has(x) || changedStatus.has(x) || known.get(x).day >= state.refetchFrom)));
            state.units.shift();
            continue;
          }
        }
        if (state.phase === "units" || state.phase === "fetch") {
          if (state.pending.length >= 100 || state.pending.length && !state.units.length) {
            const part = state.pending.slice(0, 100);
            const j = await lp(cr, "getOrdersByID", { order_id: part.join(",") });
            calls++;
            const orders = j.status === "ok" ? findOrders(j.data).map(normalizeAnOrder).filter(Boolean) : [];
            if (j.status !== "ok") warn(`LP-CRM (\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F): ${j.message || "\u043F\u043E\u043C\u0438\u043B\u043A\u0430"}`);
            await saveOrders(db, orders, maps);
            await checkTtnDups(orders, { firstRun: state.firstRun || state.mode === "reset" }).catch(() => 0);
            state.stats.fetched += orders.length;
            state.pending = state.pending.slice(part.length);
            continue;
          }
          if (!state.units.length) state.phase = "deliv";
          continue;
        }
        if (state.phase === "deliv") {
          const fill = await getJson("an_deliv_fill") || {};
          const today2 = kyivDay();
          if (fill.day !== today2) {
            fill.day = today2;
            fill.n = 0;
          }
          if (fill.done || fill.n >= DELIV_PER_DAY || (state.stats.deliv || 0) >= DELIV_PER_RUN) {
            state.phase = "products";
            continue;
          }
          const rows = await db.all(
            `SELECT id, code FROM an_orders WHERE id < ? AND deliv IS NULL ORDER BY id DESC LIMIT 100`,
            [fill.cursor ?? Number.MAX_SAFE_INTEGER]
          );
          if (!rows.length) {
            fill.done = true;
            await putSetting2("an_deliv_fill", JSON.stringify(fill));
            state.phase = "products";
            continue;
          }
          const j = await lp(cr, "getOrdersByID", { order_id: rows.map((r) => r.code).join(",") });
          calls++;
          if (j.status !== "ok") {
            warn(`LP-CRM (\u0441\u043B\u0443\u0436\u0431\u0438 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438): ${j.message || "\u043F\u043E\u043C\u0438\u043B\u043A\u0430"}`);
            state.phase = "products";
            continue;
          }
          const byCode = new Map(findOrders(j.data).map((o) => [String(o.order_id || ""), delivName(o)]));
          await db.batch(rows.map((r) => [`UPDATE an_orders SET deliv = ? WHERE id = ?`, [byCode.get(r.code) ?? "", r.id]]));
          fill.cursor = rows[rows.length - 1].id;
          fill.n = (fill.n || 0) + rows.length;
          await putSetting2("an_deliv_fill", JSON.stringify(fill));
          state.stats.deliv = (state.stats.deliv || 0) + rows.length;
          continue;
        }
        if (state.phase === "products") {
          const rows = await db.all(`SELECT product_id FROM an_products WHERE fetched = 0 LIMIT 50`);
          if (!rows.length) {
            state.phase = state.mode !== "today" || state.stats.products > 0 ? "categories" : "cleanup";
            continue;
          }
          const ids = rows.map((r) => r.product_id);
          const j = await lp(cr, "getProduct", { product_id: ids.join(","), status_ignore: "1" });
          calls++;
          const cat = /* @__PURE__ */ new Map();
          if (j.status === "ok") for (const p of findProducts2(j.data)) cat.set(parseInt(p.id ?? p.product_id, 10), parseInt(p.category_id, 10) || null);
          await db.batch(ids.map((id) => [`UPDATE an_products SET category_id = ?, fetched = 1 WHERE product_id = ?`, [cat.get(id) ?? null, id]]));
          state.stats.products += ids.length;
          continue;
        }
        if (state.phase === "categories") {
          const j = await lp(cr, "getCategories", {});
          calls++;
          if (j.status === "ok") {
            const cats = flattenCategories(j.data);
            await db.batch(cats.map((x) => [
              `INSERT INTO an_categories (id, name, parent_id) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id
               WHERE an_categories.name IS NOT excluded.name OR an_categories.parent_id IS NOT excluded.parent_id`,
              [x.id, x.name, x.parent_id]
            ]));
          }
          state.phase = "cleanup";
          continue;
        }
        if (state.phase === "cleanup") {
          if (calls > 0) break;
          const keepFrom = state.keepFrom || state.start;
          const old = await db.get(`SELECT MAX(max_id) AS hi FROM an_day_bounds WHERE day < ?`, [keepFrom]);
          if (old?.hi != null) {
            await db.batch([
              [`DELETE FROM an_items WHERE id < ?`, [(old.hi + 1) * 100]],
              [`DELETE FROM an_orders WHERE id <= ? AND day < ?`, [old.hi, keepFrom]],
              [`DELETE FROM an_day_bounds WHERE day < ?`, [keepFrom]]
            ]);
          }
          if (state.mode !== "today" || state.stats.products > 0) await rebrand(db);
          if (state.firstRun) await db.run(`UPDATE an_products SET seen = 1 WHERE seen = 0`);
          if (state.mode === "today") await mergeTodayValues(state.today);
          else await computeValues();
          state.phase = "done";
          state.finishedAt = nowIso();
          await putSetting2("an_last_sync", state.finishedAt);
          if (state.mode !== "today") await putSetting2("an_last_daily", state.finishedAt);
          await bump();
        }
      }
    } catch (e) {
      if (!e.pending) {
        if (!/429/.test(e.message)) {
          state.error = e.message;
          await services.errlog?.log(e, { path: "/api/an/sync", source: /D1_/.test(e.message) ? "" : "LP-CRM (\u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430)" });
        } else warn("LP-CRM \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u043B\u0430 \u0437\u0430\u0447\u0435\u043A\u0430\u0442\u0438 (429) \u2014 \u043F\u0440\u043E\u0434\u043E\u0432\u0436\u0443 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E.");
      }
    }
    state.lockUntil = 0;
    await save();
    return c.json({ state: summary(state) });
  });
  app.post("/api/an/sync/cancel", async (c) => {
    const s = await getJson("an_sync");
    if (s && s.phase !== "done") {
      s.error = "\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E";
      s.lockUntil = 0;
      await putSetting2("an_sync", JSON.stringify(s));
    }
    return c.json({ ok: true });
  });
  app.post("/api/an/query", async (c) => {
    const b = await c.req.json();
    const st = await getSt();
    const today2 = kyivDay();
    const from = isDay(b.from) ? b.from : addDays(today2, -6);
    const to = isDay(b.to) && b.to >= from ? b.to : today2;
    if (daysBetween(from, to) > 400) throw fail(400, "\u041F\u0435\u0440\u0456\u043E\u0434 \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439 (\u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 400 \u0434\u043D\u0456\u0432).");
    const cmp = st.compare && isDay(b.cmpFrom) && isDay(b.cmpTo) && b.cmpTo >= b.cmpFrom ? { from: b.cmpFrom, to: b.cmpTo } : null;
    const ints = (a) => Array.isArray(a) ? a.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)).slice(0, 40) : [];
    const f = {
      depts: ints(b.depts),
      sources: ints(b.sources),
      managers: (Array.isArray(b.managers) ? b.managers : []).map(low).filter(Boolean).slice(0, 40),
      brands: ints(b.brands),
      cats: ints(b.cats)
    };
    const own = c.get("anOwn");
    if (own) f.managers = own.length ? own : [""];
    const itemLevel = f.brands.length > 0 || f.cats.length > 0;
    const ok = st.okStatuses.map(Number);
    const rf = st.refuseStatuses.map(Number);
    const tracked = [...ok, ...rf];
    const ph = (a) => a.map(() => "?").join(",");
    const rfExpr = `(CASE WHEN o.status IN (${rf.join(",") || "-1"}) THEN 1 ELSE 0 END)`;
    const ver = (await db.get(`SELECT value FROM settings WHERE key = 'an_ver'`))?.value || "0";
    const cacheKey = await hashKey(JSON.stringify({ ver, from, to, cmp, f, today: today2, kpi: 4 }));
    const hit = await db.get(`SELECT value FROM an_cache WHERE key = ?`, [cacheKey]);
    if (hit) return c.body(hit.value, 200, { "content-type": "application/json; charset=UTF-8" });
    function base(range, { items = itemLevel, skipCats = false } = {}) {
      const where = [`o.id BETWEEN ? AND ?`, `o.day BETWEEN ? AND ?`, `+o.status IN (${tracked.join(",")})`];
      const params = [range.lo, range.hi, range.from, range.to];
      if (f.depts.length) {
        where.push(`o.dept IN (${ph(f.depts)})`);
        params.push(...f.depts);
      }
      if (f.sources.length) {
        where.push(`o.src IN (${ph(f.sources)})`);
        params.push(...f.sources);
      }
      if (f.managers.length) {
        where.push(`o.user IN (${ph(f.managers)})`);
        params.push(...f.managers);
      }
      let join = "";
      if (items) {
        join = `CROSS JOIN an_items i ON i.id BETWEEN o.id * 100 AND o.id * 100 + 99 LEFT JOIN an_products p ON p.product_id = i.product_id`;
        if (f.brands.length) {
          where.push(`COALESCE(p.brand_id, 0) IN (${ph(f.brands)})`);
          params.push(...f.brands);
        }
        if (f.cats.length && !skipCats) {
          where.push(`COALESCE(p.cat_manual, p.category_id, 0) IN (${ph(f.cats)})`);
          params.push(...f.cats);
        }
      }
      return { from: `FROM an_orders o ${join} WHERE ${where.join(" AND ")}`, params };
    }
    const orderMeasures = (items) => items ? `SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net, COUNT(DISTINCT o.id) AS cnt,
         COUNT(DISTINCT CASE WHEN ${rfExpr} = 1 THEN o.id END) AS rcnt` : `SUM(o.total) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN o.total ELSE 0 END) AS net, COUNT(*) AS cnt, SUM(${rfExpr}) AS rcnt`;
    async function period(p, full) {
      const r = await idRange(db, p.from, p.to);
      const empty = { daily: [], groups: [], brands: [], cats: [], top: [] };
      if (!r) return empty;
      const range = { lo: r[0], hi: r[1], from: p.from, to: p.to };
      const q = base(range);
      const qi = base(range, { items: true });
      const topJob = full ? db.all(`SELECT i.product_id AS id, MAX(p.name) AS name, MAX(p.brand_id) AS brand, SUM(i.amount) AS rev,
                SUM(i.qty) AS qty, SUM(CASE WHEN ${rfExpr} = 1 THEN i.qty ELSE 0 END) AS rqty
                ${qi.from} GROUP BY i.product_id ORDER BY rev DESC LIMIT 20`, qi.params) : Promise.resolve([]);
      if (daysBetween(p.from, p.to) <= 92) {
        const [rows, oi, top3] = await Promise.all([
          db.all(`SELECT o.day AS day, o.dept AS dept, o.src AS src, o.user AS user, o.status AS status, o.deliv AS deliv, ${orderMeasures(itemLevel)} ${q.from}
                  GROUP BY o.day, o.dept, o.src, o.user, o.status, o.deliv`, q.params),
          db.all(`SELECT o.id AS oid, COALESCE(p.brand_id, 0) AS b, COALESCE(p.cat_manual, p.category_id, 0) AS c, MAX(${rfExpr}) AS rf,
                  SUM(i.amount) AS rev, SUM(i.qty) AS qty ${qi.from} GROUP BY o.id, COALESCE(p.brand_id, 0), COALESCE(p.cat_manual, p.category_id, 0)`, qi.params),
          topJob
        ]);
        const add = (m, k, init) => {
          let x = m.get(k);
          if (!x) {
            x = init();
            m.set(k, x);
          }
          return x;
        };
        const dm = /* @__PURE__ */ new Map();
        const gm = /* @__PURE__ */ new Map();
        for (const r2 of rows) {
          const d = add(dm, r2.day, () => ({ day: r2.day, rev: 0, net: 0, cnt: 0, rcnt: 0 }));
          const g = add(gm, `${r2.dept}|${r2.src}|${r2.user}|${r2.status}|${r2.deliv}`, () => ({ dept: r2.dept, src: r2.src, user: r2.user, status: r2.status, deliv: r2.deliv, rev: 0, net: 0, cnt: 0, rcnt: 0 }));
          for (const x of [d, g]) {
            x.rev += r2.rev || 0;
            x.net += r2.net || 0;
            x.cnt += r2.cnt || 0;
            x.rcnt += r2.rcnt || 0;
          }
        }
        const bm = /* @__PURE__ */ new Map();
        const cm = /* @__PURE__ */ new Map();
        for (const r2 of oi) {
          for (const [m, k] of [[bm, r2.b], [cm, r2.c]]) {
            const x = add(m, k, () => ({ id: k, rev: 0, net: 0, qty: 0, orders: /* @__PURE__ */ new Set(), rorders: /* @__PURE__ */ new Set() }));
            x.rev += r2.rev || 0;
            x.qty += r2.qty || 0;
            if (!r2.rf) x.net += r2.rev || 0;
            x.orders.add(r2.oid);
            if (r2.rf) x.rorders.add(r2.oid);
          }
        }
        const fin = (m) => [...m.values()].map(({ orders, rorders, ...x }) => ({ ...x, cnt: orders.size, rcnt: rorders.size }));
        return { daily: [...dm.values()], groups: [...gm.values()], brands: fin(bm), cats: fin(cm), top: top3 };
      }
      const [daily, groups, brands2, cats, top2] = await Promise.all([
        db.all(`SELECT o.day AS day, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.day`, q.params),
        db.all(`SELECT o.dept AS dept, o.src AS src, o.user AS user, o.status AS status, o.deliv AS deliv, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.dept, o.src, o.user, o.status, o.deliv`, q.params),
        db.all(`SELECT COALESCE(p.brand_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt, COUNT(DISTINCT CASE WHEN ${rfExpr} = 1 THEN o.id END) AS rcnt
                ${qi.from} GROUP BY COALESCE(p.brand_id, 0)`, qi.params),
        db.all(`SELECT COALESCE(p.cat_manual, p.category_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt
                ${qi.from} GROUP BY COALESCE(p.cat_manual, p.category_id, 0)`, qi.params),
        topJob
      ]);
      return { daily, groups, brands: brands2, cats, top: top2 };
    }
    const [cur, prev, depts, sources, managers, brands, categories, targets, catOptions] = await Promise.all([
      period({ from, to }, true),
      cmp ? period(cmp, false) : null,
      db.all(`SELECT id, name, sort FROM an_depts ORDER BY sort, id`),
      db.all(`SELECT id, dept_id, name, sort FROM an_sources ORDER BY sort, id`),
      db.all(`SELECT login, name, dept_id FROM an_managers`),
      db.all(`SELECT id, name FROM an_brands ORDER BY sort, id`),
      db.all(`SELECT id, name, parent_id FROM an_categories`),
      db.all(`SELECT month, kind, ref_id, amount FROM an_targets WHERE month BETWEEN ? AND ?`, [from.slice(0, 7), to.slice(0, 7)]),
      f.brands.length ? db.all(`SELECT DISTINCT COALESCE(cat_manual, category_id, 0) AS id FROM an_products WHERE brand_id IN (${ph(f.brands)})`, f.brands) : db.all(`SELECT DISTINCT COALESCE(cat_manual, category_id, 0) AS id FROM an_products`)
    ]);
    const sumRows = (rows) => rows.reduce((a, r) => ({ rev: a.rev + (r.rev || 0), net: a.net + (r.net || 0), cnt: a.cnt + (r.cnt || 0), rcnt: a.rcnt + (r.rcnt || 0) }), { rev: 0, net: 0, cnt: 0, rcnt: 0 });
    const statusNames0 = await getJson("an_status_names") || {};
    const done = (Array.isArray(st.doneStatuses) && st.doneStatuses.length ? st.doneStatuses.map(Number) : ok.filter((id) => /заверш|выполн|викон/i.test(statusNames0[id] || ""))).filter((id) => ok.includes(id));
    const doneIds = done.length ? done : ok.filter((id) => id === 18);
    const statusNamesG = statusNames0;
    const byName = (re, fallback) => {
      const ids = ok.filter((id) => re.test(statusNamesG[id] || ""));
      return ids.length ? ids : ok.filter((id) => fallback.includes(id));
    };
    const shipping = byName(/отправ|відправ|ожида|очіку/i, [14, 53]).filter((id) => !doneIds.includes(id));
    const acceptedOnly = byName(/принят|прийн/i, [11]).filter((id) => !doneIds.includes(id) && !shipping.includes(id));
    const kpi = (p) => {
      const t = sumRows(p.groups);
      const d = sumRows(p.groups.filter((r) => doneIds.includes(Number(r.status))));
      const sh = sumRows(p.groups.filter((r) => !acceptedOnly.includes(Number(r.status))));
      return {
        ...t,
        rev: round2(t.rev),
        net: round2(t.net),
        avg: t.cnt ? round2(t.rev / t.cnt) : 0,
        rpct: t.cnt ? round2(t.rcnt / t.cnt * 100) : 0,
        ncnt: t.cnt - t.rcnt,
        // замовлень без відмов
        rrev: round2(t.rev - t.net),
        // сума відмов і повернень
        drev: round2(d.rev),
        dcnt: d.cnt,
        dpct: t.cnt ? round2(d.cnt / t.cnt * 100) : 0,
        // завершені
        // відправлені: усі, крім «Прийнято» (відправлено, очікує викупу, завершено, відмови, повернення)
        srev: round2(sh.rev),
        snet: round2(sh.net),
        scnt: sh.cnt,
        srcnt: sh.rcnt,
        spct: t.cnt ? round2(sh.cnt / t.cnt * 100) : 0
      };
    };
    const fillDays = (p, a, z) => {
      const map = new Map((p?.daily || []).map((r) => [r.day, r]));
      const out2 = [];
      for (let d = a; d <= z; d = addDays(d, 1)) {
        const r = map.get(d) || {};
        out2.push({ day: d, rev: round2(r.rev || 0), net: round2(r.net || 0), cnt: r.cnt || 0 });
      }
      return out2;
    };
    const group = (p, key) => {
      const m = /* @__PURE__ */ new Map();
      for (const r of p?.groups || []) {
        const k = r[key];
        const cur2 = m.get(k) || { rev: 0, net: 0, cnt: 0, rcnt: 0 };
        cur2.rev += r.rev || 0;
        cur2.net += r.net || 0;
        cur2.cnt += r.cnt || 0;
        cur2.rcnt += r.rcnt || 0;
        m.set(k, cur2);
      }
      return m;
    };
    const tmap = new Map(targets.map((t) => [`${t.month}|${t.kind}|${t.ref_id}`, t.amount]));
    const srcTarget = (month, id) => tmap.get(`${month}|src|${id}`) || 0;
    const deptTarget = (month, id) => {
      const own2 = tmap.get(`${month}|dept|${id}`);
      if (own2) return own2;
      return sources.filter((s) => s.dept_id === id).reduce((a, s) => a + srcTarget(month, s.id), 0);
    };
    const planFor = (fn, a, z) => {
      let sum = 0;
      for (let d = a; d <= z; d = addDays(d, 1)) sum += fn(d.slice(0, 7)) / daysInMonth(d);
      return round2(sum);
    };
    let scopeFn = null;
    let targetNote = "";
    if (f.managers.length || itemLevel) targetNote = "\u0422\u0430\u0440\u0433\u0435\u0442 \u0437\u0430\u0434\u0430\u0454\u0442\u044C\u0441\u044F \u043D\u0430 \u0432\u0456\u0434\u0434\u0456\u043B\u0438 \u0456 \u0434\u0436\u0435\u0440\u0435\u043B\u0430 \u2014 \u0437 \u0444\u0456\u043B\u044C\u0442\u0440\u043E\u043C \u0437\u0430 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u043E\u043C, \u0431\u0440\u0435\u043D\u0434\u043E\u043C \u0430\u0431\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0454\u044E \u0432\u0456\u043D \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u0443\u0454\u0442\u044C\u0441\u044F.";
    else if (f.sources.length) scopeFn = (m) => f.sources.reduce((a, id) => a + srcTarget(m, id), 0);
    else if (f.depts.length) scopeFn = (m) => f.depts.reduce((a, id) => a + (id ? deptTarget(m, id) : 0), 0);
    else scopeFn = (m) => depts.reduce((a, d) => a + deptTarget(m, d.id), 0);
    const factKey = st.targetBase === "all" ? "rev" : "net";
    const curDaily = fillDays(cur, from, to);
    let target = { applicable: false, note: own ? "" : targetNote, base: factKey };
    if (scopeFn) {
      const perDay = curDaily.map((d) => round2(scopeFn(d.day.slice(0, 7)) / daysInMonth(d.day)));
      const plan = round2(perDay.reduce((a, x) => a + x, 0));
      if (plan > 0) {
        const fact = round2(curDaily.reduce((a, d) => a + d[factKey], 0));
        target = { applicable: true, base: factKey, perDay, plan, fact, diff: round2(fact - plan), pct: round2(fact / plan * 100) };
        if (from === monthStart(to)) {
          const dim = daysInMonth(to);
          const elapsed = daysBetween(from, to);
          const monthPlan = round2(scopeFn(to.slice(0, 7)));
          const forecast = round2(fact / elapsed * dim);
          const left = dim - elapsed;
          target.month = {
            name: to.slice(0, 7),
            plan: monthPlan,
            fact,
            elapsed,
            days: dim,
            forecast,
            forecastPct: monthPlan ? round2(forecast / monthPlan * 100) : 0,
            needPerDay: left > 0 ? round2(Math.max(0, monthPlan - fact) / left) : 0,
            avgPerDay: round2(fact / elapsed),
            left
          };
        }
      } else {
        target = { applicable: false, base: factKey, note: "\u0422\u0430\u0440\u0433\u0435\u0442 \u043D\u0430 \u0446\u0435\u0439 \u043F\u0435\u0440\u0456\u043E\u0434 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E \u2014 \u0432\u0441\u0442\u0430\u043D\u043E\u0432\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0432 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0438 \u2192 \u0422\u0430\u0440\u0433\u0435\u0442\u0438\xBB." };
      }
    }
    const dCur = group(cur, "dept");
    const dPrev = group(prev, "dept");
    const sCur = group(cur, "src");
    const sPrev = group(prev, "src");
    const mCur = group(cur, "user");
    const mPrev = group(prev, "user");
    const stCur = group(cur, "status");
    const pick2 = (m, k) => m.get(k) || { rev: 0, net: 0, cnt: 0, rcnt: 0 };
    const row = (m, pm, k) => {
      const a = pick2(m, k);
      const p = pm ? pick2(pm, k) : null;
      return { rev: round2(a.rev), net: round2(a.net), cnt: a.cnt, rcnt: a.rcnt, prevRev: p ? round2(p.rev) : null, prevNet: p ? round2(p.net) : null, prevCnt: p ? p.cnt : null };
    };
    const planPeriod = (fn) => f.managers.length || itemLevel ? 0 : planFor(fn, from, to);
    const byDept = [...depts.map((d) => ({ id: d.id, name: d.name })), { id: 0, name: "\u0411\u0435\u0437 \u0432\u0456\u0434\u0434\u0456\u043B\u0443" }].map((d) => ({ ...d, ...row(dCur, prev && dPrev, d.id), plan: d.id ? planPeriod((m) => deptTarget(m, d.id)) : 0 })).filter((d) => d.cnt || d.prevCnt || d.plan);
    const bySource = [...sources.map((s) => ({ id: s.id, name: s.name, dept_id: s.dept_id })), { id: 0, name: "\u0411\u0435\u0437 \u0434\u0436\u0435\u0440\u0435\u043B\u0430", dept_id: null }].map((s) => ({ ...s, ...row(sCur, prev && sPrev, s.id), plan: s.id ? planPeriod((m) => srcTarget(m, s.id)) : 0 })).filter((s) => s.cnt || s.prevCnt || s.plan);
    const mgrNames = new Map(managers.map((m) => [m.login, m]));
    const byManager = [.../* @__PURE__ */ new Set([...mCur.keys(), ...prev ? mPrev.keys() : []])].map((login) => ({
      login,
      name: mgrNames.get(login)?.name || login || "\u2014",
      dept_id: mgrNames.get(login)?.dept_id || null,
      ...row(mCur, prev && mPrev, login)
    })).sort((a, b2) => b2.rev - a.rev);
    const statusNames = await getJson("an_status_names") || {};
    const byStatus = tracked.map((id) => ({ id, name: statusNames[id] || `\u0421\u0442\u0430\u0442\u0443\u0441 ${id}`, refuse: rf.includes(id), ...row(stCur, null, id) }));
    const stPrev = prev ? group(prev, "status") : null;
    const groupRow = (id, name, ids) => {
      const sum = (m) => ids.reduce((a2, s) => {
        const r = m?.get(s);
        return r ? { rev: a2.rev + r.rev, cnt: a2.cnt + r.cnt } : a2;
      }, { rev: 0, cnt: 0 });
      const a = sum(stCur);
      const p = stPrev ? sum(stPrev) : null;
      return { id, name, statuses: ids, rev: round2(a.rev), cnt: a.cnt, prevRev: p ? round2(p.rev) : null, prevCnt: p ? p.cnt : null };
    };
    const byStatusGroup = [
      groupRow("accepted", "\u041F\u0440\u0438\u0439\u043D\u044F\u0442\u043E", acceptedOnly),
      groupRow("done", "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E", doneIds),
      groupRow("shipping", "\u0412\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0456 \u043E\u0447\u0456\u043A\u0443\u0454 \u0432\u0438\u043A\u0443\u043F\u0443", shipping),
      groupRow("refused", "\u041F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u043E \u043D\u0430 \u0441\u043A\u043B\u0430\u0434 \u0456 \u0432\u0456\u0434\u043C\u043E\u0432\u0438", rf)
    ];
    const delivMap = (p) => {
      const m = /* @__PURE__ */ new Map();
      for (const r of p?.groups || []) {
        const k = delivGroup(r.deliv);
        const cur2 = m.get(k) || { rev: 0, cnt: 0, rcnt: 0, names: /* @__PURE__ */ new Set() };
        cur2.rev += r.rev || 0;
        cur2.cnt += r.cnt || 0;
        cur2.rcnt += r.rcnt || 0;
        if (r.deliv) cur2.names.add(r.deliv);
        m.set(k, cur2);
      }
      return m;
    };
    const dvCur = delivMap(cur);
    const dvPrev = prev ? delivMap(prev) : null;
    const byDelivery = [.../* @__PURE__ */ new Set([...dvCur.keys(), ...dvPrev ? dvPrev.keys() : []])].map((name) => {
      const a = dvCur.get(name) || { rev: 0, cnt: 0, rcnt: 0, names: /* @__PURE__ */ new Set() };
      const p = dvPrev?.get(name);
      return {
        id: name,
        name,
        rev: round2(a.rev),
        cnt: a.cnt,
        rcnt: a.rcnt,
        names: [...a.names].slice(0, 5),
        pending: name === "\u0429\u0435 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0443\u0454\u0442\u044C\u0441\u044F",
        prevRev: dvPrev ? round2(p?.rev || 0) : null,
        prevCnt: dvPrev ? p?.cnt || 0 : null
      };
    }).filter((r) => r.cnt || r.prevCnt).sort((a, b2) => b2.cnt - a.cnt);
    const bName = new Map(brands.map((x) => [x.id, x.name]));
    const prevBrands = new Map((prev?.brands || []).map((r) => [r.id, r]));
    const byBrand = cur.brands.map((r) => ({
      id: r.id,
      name: r.id ? bName.get(r.id) || `\u0411\u0440\u0435\u043D\u0434 ${r.id}` : "\u0406\u043D\u0448\u0456",
      rev: round2(r.rev),
      net: round2(r.net),
      qty: r.qty,
      cnt: r.cnt,
      rcnt: r.rcnt,
      avg: r.cnt ? round2(r.rev / r.cnt) : 0,
      prevRev: prev ? round2(prevBrands.get(r.id)?.rev || 0) : null,
      prevNet: prev ? round2(prevBrands.get(r.id)?.net || 0) : null
    })).sort((a, b2) => b2.rev - a.rev);
    const cName = new Map(categories.map((x) => [x.id, x.name]));
    const prevCats = new Map((prev?.cats || []).map((r) => [r.id, r]));
    const byCategory = cur.cats.map((r) => ({
      id: r.id,
      name: r.id ? cName.get(r.id) || `\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u044F ${r.id}` : "\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457",
      rev: round2(r.rev),
      net: round2(r.net),
      qty: r.qty,
      cnt: r.cnt,
      prevRev: prev ? round2(prevCats.get(r.id)?.rev || 0) : null,
      prevNet: prev ? round2(prevCats.get(r.id)?.net || 0) : null
    })).sort((a, b2) => b2.rev - a.rev);
    const top = cur.top.map((r) => ({ id: r.id, name: r.name || `\u0422\u043E\u0432\u0430\u0440 ${r.id}`, brand: r.brand ? bName.get(r.brand) || "\u0406\u043D\u0448\u0456" : "\u0406\u043D\u0448\u0456", rev: round2(r.rev), qty: r.qty, rqty: r.rqty }));
    const last = await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`);
    const out = JSON.stringify({
      own: own ? { logins: own } : null,
      range: { from, to, days: daysBetween(from, to) },
      cmp,
      compareEnabled: st.compare,
      targetBase: st.targetBase,
      kpi: { cur: kpi(cur), prev: prev ? kpi(prev) : null, doneStatuses: doneIds },
      daily: { cur: curDaily, prev: cmp ? fillDays(prev, cmp.from, cmp.to) : null },
      target,
      byDept,
      bySource,
      byManager,
      byStatus,
      byStatusGroup,
      byDelivery,
      byBrand,
      byCategory,
      top,
      options: {
        depts: [...depts.map((d) => ({ id: d.id, name: d.name })), { id: 0, name: "\u0411\u0435\u0437 \u0432\u0456\u0434\u0434\u0456\u043B\u0443" }],
        sources: sources.map((s) => ({ id: s.id, name: s.name, dept_id: s.dept_id })),
        managers: own ? own.map((l) => ({ login: l, name: managers.find((m) => m.login === l)?.name || l, dept_id: null, own: true })) : [...new Map([
          ...managers.map((m) => [m.login, { login: m.login, name: m.name || m.login, dept_id: m.dept_id }]),
          ...byManager.filter((m) => !mgrNames.has(m.login)).map((m) => [m.login, { login: m.login, name: m.login, dept_id: null }])
        ]).values()],
        brands: [...brands.map((x) => ({ id: x.id, name: x.name })), { id: 0, name: "\u0406\u043D\u0448\u0456" }],
        cats: catOptions.map((r) => ({ id: r.id, name: r.id ? cName.get(r.id) || `\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u044F ${r.id}` : "\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457" })).sort((a, b2) => (a.id === 0) - (b2.id === 0) || a.name.localeCompare(b2.name, "uk"))
      },
      lastSync: last?.value || ""
    });
    await db.batch([
      [`DELETE FROM an_cache WHERE at < ?`, [Date.now() - 2 * 864e5]],
      [`INSERT OR REPLACE INTO an_cache (key, value, at) VALUES (?, ?, ?)`, [cacheKey, out, Date.now()]]
    ]);
    return c.body(out, 200, { "content-type": "application/json; charset=UTF-8" });
  });
}
async function hashKey(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// src/modules/notify/index.js
var tgName = (x) => `${[x?.first_name, x?.last_name].filter(Boolean).join(" ")}${x?.username ? ` (@${x.username})` : ""}`.trim().slice(0, 120) || `id ${x?.id ?? ""}`;
var TG = "https://api.telegram.org";
var ALLOWED_UPDATES = ["message", "callback_query"];
var HOOK_V = "2";
var h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var nf = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var uah = (n) => `${nf.format(Number(n) || 0)} \u20B4`;
var kyivAt = (ms) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ms)).replace(" ", "T");
function mountTg(app, { db, fetchFn, services = {} }) {
  const settings = () => loadSettings(db);
  const putSetting2 = (key, value) => putSetting(db, key, value);
  async function tg(token, method, body) {
    const r = await fetchFn(`${TG}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    let j = null;
    try {
      j = await r.json();
    } catch {
    }
    if (!j?.ok) throw fail(400, `Telegram: ${j?.description || `\u043F\u043E\u043C\u0438\u043B\u043A\u0430 ${r.status}`}`);
    return j.result;
  }
  app.put("/api/tg/settings", async (c) => {
    need(c, "api");
    const b = await c.req.json();
    const token = String(b.token || "").trim();
    if (!token) {
      const s = await settings();
      if (s.tg_token) await tg(s.tg_token, "deleteWebhook", {}).catch(() => {
      });
      await db.batch([[`DELETE FROM settings WHERE key IN ('tg_token', 'tg_bot', 'tg_secret')`, []]]);
      return c.json({ ok: true, bot: "" });
    }
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw fail(400, "\u0421\u0445\u043E\u0436\u0435, \u0446\u0435 \u043D\u0435 \u0442\u043E\u043A\u0435\u043D \u0431\u043E\u0442\u0430. \u0412\u0456\u043D \u0432\u0438\u0433\u043B\u044F\u0434\u0430\u0454 \u0442\u0430\u043A: 1234567890:AAH\u2026");
    const me = await tg(token, "getMe");
    const secret = randomToken(16);
    const url = `${new URL(c.req.url).origin}/api/tg/hook`;
    await tg(token, "setWebhook", { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
    await putSetting2("tg_hook_v", HOOK_V);
    await putSetting2("tg_token", token);
    await putSetting2("tg_bot", me.username || "");
    await putSetting2("tg_secret", secret);
    return c.json({ ok: true, bot: me.username || "" });
  });
  app.get("/api/tg/me", async (c) => {
    const s = await settings();
    const u = await db.get(`SELECT tg_chat_id, tg_all_links, tg_all_tx FROM users WHERE id = ?`, [c.get("user").id]);
    return c.json({ bot: s.tg_bot || "", connected: Boolean(u?.tg_chat_id), allLinks: Boolean(u?.tg_all_links), allTx: Boolean(u?.tg_all_tx) });
  });
  app.post("/api/tg/link", async (c) => {
    const s = await settings();
    if (!s.tg_token || !s.tg_bot) throw fail(400, "Telegram-\u0431\u043E\u0442\u0430 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u2014 \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u0432\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u0430\u0431\u043E \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430.");
    const code = randomToken(12);
    await db.run(`UPDATE users SET tg_code = ? WHERE id = ?`, [`${code}|${Date.now() + 15 * 6e4}`, c.get("user").id]);
    return c.json({ url: `https://t.me/${s.tg_bot}?start=${code}` });
  });
  app.delete("/api/tg/me", async (c) => {
    await db.run(`UPDATE users SET tg_chat_id = '', tg_code = '', tg_name = '', tg_linked_at = '' WHERE id = ?`, [c.get("user").id]);
    return c.json({ ok: true });
  });
  async function fillTgNames(limit = 15) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const rows = await db.all(`SELECT id, tg_chat_id FROM users WHERE tg_chat_id != '' AND COALESCE(tg_name, '') = '' LIMIT ?`, [limit]);
    let n = 0;
    for (const r of rows) {
      const ch = await tg(s.tg_token, "getChat", { chat_id: r.tg_chat_id }).catch(() => null);
      await db.run(`UPDATE users SET tg_name = ? WHERE id = ?`, [ch ? tgName(ch) : "(\u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0438\u0439 \u2014 \u0431\u043E\u0442\u0430 \u0437\u0430\u0431\u043B\u043E\u043A\u043E\u0432\u0430\u043D\u043E?)", r.id]);
      n++;
    }
    return n;
  }
  app.get("/api/users/tg", async (c) => {
    need(c, "people");
    await fillTgNames().catch(() => 0);
    const s = await settings();
    const rows = await db.all(`SELECT id, tg_chat_id, tg_name, tg_linked_at FROM users WHERE role != 'partner'`);
    return c.json({ bot: s.tg_bot || "", users: rows.map((r) => ({ id: r.id, connected: Boolean(r.tg_chat_id), name: r.tg_name || "", at: r.tg_linked_at || "" })) });
  });
  app.put("/api/tg/me", async (c) => {
    need(c, "users");
    const b = await c.req.json();
    await db.run(`UPDATE users SET tg_all_links = ?, tg_all_tx = ? WHERE id = ?`, [b.allLinks ? 1 : 0, b.allTx ? 1 : 0, c.get("user").id]);
    return c.json({ ok: true });
  });
  app.post("/api/tg/hook", async (c) => {
    const s = await settings();
    if (!s.tg_token || !s.tg_secret || c.req.header("x-telegram-bot-api-secret-token") !== s.tg_secret) return c.json({ ok: false }, 401);
    const upd = await c.req.json().catch(() => ({}));
    const base = new URL(c.req.url).origin;
    if (s.tg_hook_v !== HOOK_V) {
      await tg(s.tg_token, "setWebhook", { url: `${base}/api/tg/hook`, secret_token: s.tg_secret, allowed_updates: ALLOWED_UPDATES }).catch(() => {
      });
      await putSetting2("tg_hook_v", HOOK_V);
    }
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const u = await db.get(`SELECT * FROM users WHERE tg_chat_id = ? AND active = 1`, [String(cq.from?.id || "")]);
      let note = "";
      try {
        note = await services.b2b?.tgCallback?.(cq, u || null, base) || "";
      } catch (e) {
        note = String(e.message || e).slice(0, 150);
      }
      await tg(s.tg_token, "answerCallbackQuery", { callback_query_id: cq.id, text: typeof note === "string" ? note : "" }).catch(() => {
      });
      return c.json({ ok: true });
    }
    const msg = upd.message;
    const chat = msg?.chat?.id;
    if (!chat) return c.json({ ok: true });
    if (["group", "supergroup"].includes(msg.chat.type)) {
      const b2b = services.b2b;
      if (msg.migrate_to_chat_id) {
        await b2b?.tgGroupMoved?.(String(chat), String(msg.migrate_to_chat_id));
        return c.json({ ok: true });
      }
      if (msg.left_chat_member?.is_bot && msg.left_chat_member.username === s.tg_bot) {
        await b2b?.tgGroupLeft?.(String(chat));
        return c.json({ ok: true });
      }
      if (msg.document || msg.photo) {
        try {
          await services.b2b?.tgGroupMessage?.(msg, base);
        } catch (e) {
          console.error("tg group file", e);
        }
        return c.json({ ok: true });
      }
      const g = /^\/(?:link|start)(?:@\w+)?\s+([0-9a-f]{12,24})\b/i.exec(String(msg.text || ""));
      if (!g) return c.json({ ok: true });
      const reply2 = await b2b?.tgGroupLink?.(g[1].toLowerCase(), String(chat), msg.chat.title || "") || "\u041A\u043E\u0434 \u043D\u0435 \u043F\u0456\u0434\u0456\u0439\u0448\u043E\u0432. \u0412\u0456\u0437\u044C\u043C\u0456\u0442\u044C \u043D\u043E\u0432\u0438\u0439 \u043A\u043E\u0434 \u0443 \u043A\u0430\u0440\u0442\u0446\u0456 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u043D\u0430 \u0441\u0430\u0439\u0442\u0456.";
      await tg(s.tg_token, "sendMessage", { chat_id: chat, text: reply2, parse_mode: "HTML" }).catch(() => {
      });
      return c.json({ ok: true });
    }
    const m = /^\/start(?:@\w+)?\s+([0-9a-f]{24})\b/.exec(String(msg.text || ""));
    if (!m && msg.chat.type === "private") {
      const u = await db.get(`SELECT * FROM users WHERE tg_chat_id = ? AND active = 1`, [String(chat)]);
      if (u && await services.b2b?.tgPrivate?.(msg, u, base)) return c.json({ ok: true });
    }
    let reply = "\u0429\u043E\u0431 \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0442\u0438 \u0441\u043F\u043E\u0432\u0456\u0449\u0435\u043D\u043D\u044F, \u0432\u0456\u0434\u043A\u0440\u0438\u0439\u0442\u0435 \u0441\u0430\u0439\u0442, \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xABTelegram\xBB \u0443\u0433\u043E\u0440\u0456 \u0456 \u043F\u043E\u0442\u0456\u043C \xAB\u041F\u0456\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0438 Telegram\xBB.";
    if (m) {
      const u = await db.get(`SELECT id, name, login, tg_code FROM users WHERE tg_code LIKE ? AND active = 1`, [`${m[1]}|%`]);
      const exp = Number(String(u?.tg_code || "").split("|")[1]) || 0;
      if (u && exp > Date.now()) {
        await db.run(`UPDATE users SET tg_chat_id = ?, tg_code = '', tg_name = ?, tg_linked_at = ? WHERE id = ?`, [String(chat), tgName(msg.from || msg.chat), nowIso(), u.id]);
        reply = `\u2705 \u0413\u043E\u0442\u043E\u0432\u043E, ${h(u.name || u.login)}! \u0421\u044E\u0434\u0438 \u043D\u0430\u0434\u0445\u043E\u0434\u0438\u0442\u0438\u043C\u0443\u0442\u044C \u0432\u0430\u0448\u0456 \u0441\u043F\u043E\u0432\u0456\u0449\u0435\u043D\u043D\u044F.`;
      } else {
        reply = "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u0434\u043B\u044F \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u044F \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u043E. \u041D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u041F\u0456\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0438 Telegram\xBB \u043D\u0430 \u0441\u0430\u0439\u0442\u0456 \u0449\u0435 \u0440\u0430\u0437.";
      }
    }
    await tg(s.tg_token, "sendMessage", { chat_id: chat, text: reply, parse_mode: "HTML" }).catch(() => {
    });
    return c.json({ ok: true });
  });
  const LABEL = { paid: "\u2705 \u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", over: "\u2705 \u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E (\u043F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430)", partial: "\u{1F7E1} \u0427\u0430\u0441\u0442\u043A\u043E\u0432\u0430 \u043E\u043F\u043B\u0430\u0442\u0430" };
  async function notify({ linkIds = [], freshRows = [] }) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const out = [];
    const admins = await db.all(`SELECT id, tg_chat_id, tg_all_links, tg_all_tx FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin', 'admin_lite') AND (tg_all_links = 1 OR tg_all_tx = 1)`);
    if (linkIds.length) {
      const links = await db.all(
        `SELECT l.id, l.number, l.amount, l.paid_amount, l.status, l.client, l.created_by_id, l.created_by, COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, ''), a.iban) AS alias, u.tg_chat_id AS chat
         FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id LEFT JOIN users u ON u.id = l.created_by_id AND u.active = 1
         WHERE l.id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(linkIds)]
      );
      for (const l of links) {
        const text = `<b>${LABEL[l.status] || "\u041E\u043F\u043B\u0430\u0442\u0430"}: \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h(l.number)}</b>
${uah(l.paid_amount)} \u0437 ${uah(l.amount)}${l.client ? ` \xB7 ${h(l.client)}` : ""}
${h(l.alias || "")}${l.created_by ? `
\u0421\u0442\u0432\u043E\u0440\u0438\u0432(\u043B\u0430): ${h(l.created_by)}` : ""}`;
        const chats = /* @__PURE__ */ new Set();
        if (l.chat) chats.add(l.chat);
        for (const a of admins) if (a.tg_all_links) chats.add(a.tg_chat_id);
        for (const ch of chats) out.push([ch, text]);
      }
    }
    const since = kyivAt(Date.now() - 864e5);
    const recent = freshRows.filter((r) => r.date >= since);
    const txAdmins = admins.filter((a) => a.tg_all_tx);
    if (recent.length && txAdmins.length) {
      const accs = new Map((await db.all(`SELECT iban, COALESCE(NULLIF(name, ''), NULLIF(alias, ''), iban) AS alias FROM odb_accounts`)).map((a) => [a.iban, a.alias]));
      const texts = recent.length > 5 ? [`<b>\u{1F4B0} \u041D\u043E\u0432\u0456 \u043D\u0430\u0434\u0445\u043E\u0434\u0436\u0435\u043D\u043D\u044F: ${recent.length}</b> \u043D\u0430 \u0441\u0443\u043C\u0443 ${uah(recent.reduce((t, r) => t + r.amount, 0))}`] : recent.map((r) => `<b>\u{1F4B0} ${uah(r.amount)}</b> \u2192 ${h(accs.get(r.iban) || r.iban)}
\u0412\u0456\u0434: ${h(r.payer_name || "\u2014")}
<i>${h(String(r.purpose || "").slice(0, 200))}</i>`);
      for (const a of txAdmins) for (const t of texts) out.push([a.tg_chat_id, t]);
    }
    let sent = 0;
    for (const [chat, text] of out.slice(0, 15)) {
      try {
        await tg(s.tg_token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
        sent++;
      } catch {
      }
    }
    return sent;
  }
  async function sendText({ admins = false, userIds = [], partnerId = null, chatIds = [] }, text) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const chats = new Set(chatIds.filter(Boolean).map(String));
    if (admins) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin', 'admin_lite')`)) chats.add(r.tg_chat_id);
    if (userIds.length) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND id IN (SELECT value FROM json_each(?))`, [JSON.stringify(userIds)])) chats.add(r.tg_chat_id);
    if (partnerId) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND role = 'partner' AND partner_id = ?`, [partnerId])) chats.add(r.tg_chat_id);
    let sent = 0;
    for (const chat of [...chats].slice(0, 30)) {
      try {
        await tg(s.tg_token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
        sent++;
      } catch {
      }
    }
    return sent;
  }
  let lastMessage = null;
  async function sendFile({ chatIds = [] }, { bytes, name, mime, fileId }, caption = "") {
    const s = await settings();
    lastMessage = null;
    if (!s.tg_token || !chatIds.length) return 0;
    let sent = 0;
    for (const chat of chatIds.slice(0, 5)) {
      if (fileId) {
        const r = await tg(s.tg_token, "sendDocument", { chat_id: chat, document: fileId, ...caption ? { caption: caption.slice(0, 1e3), parse_mode: "HTML" } : {} }).catch(() => null);
        if (r) {
          sent++;
          lastMessage = { chat: String(chat), id: r.message_id };
        }
        continue;
      }
      const fd = new FormData();
      fd.append("chat_id", String(chat));
      if (caption) {
        fd.append("caption", caption.slice(0, 1e3));
        fd.append("parse_mode", "HTML");
      }
      fd.append("document", new Blob([bytes], { type: mime || "application/octet-stream" }), name || "file");
      try {
        const r = await fetchFn(`${TG}/bot${s.tg_token}/sendDocument`, { method: "POST", body: fd });
        const j = await r.json().catch(() => null);
        if (j?.ok) {
          sent++;
          lastMessage = { chat: String(chat), id: j.result?.message_id };
        }
      } catch {
      }
    }
    return sent;
  }
  async function api(method, body) {
    const s = await settings();
    if (!s.tg_token) throw fail(400, "Telegram-\u0431\u043E\u0442\u0430 \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E.");
    return tg(s.tg_token, method, body);
  }
  async function download(fileId) {
    const s = await settings();
    const f = await tg(s.tg_token, "getFile", { file_id: fileId });
    const r = await fetchFn(`${TG}/file/bot${s.tg_token}/${f.file_path}`);
    if (!r.ok) throw fail(502, "Telegram: \u043D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 \u0444\u0430\u0439\u043B.");
    return new Uint8Array(await r.arrayBuffer());
  }
  return { fillTgNames, notify, sendText, sendFile, api, download, lastFileMessage: () => lastMessage };
}

// src/modules/errlog/index.js
var KEEP_DAYS = 30;
var TG_EVERY_MS = 60 * 60 * 1e3;
function errSource(message, path = "") {
  const m = String(message || "");
  if (/D1_|SQLITE|database/i.test(m)) return "\u0411\u0430\u0437\u0430 \u0434\u0430\u043D\u0438\u0445 (D1)";
  if (/LP-CRM|lp-crm/i.test(m)) return "LP-CRM";
  if (/Opendatabot/i.test(m)) return "Opendatabot";
  if (/Нова пошта|novaposhta/i.test(m)) return "\u041D\u043E\u0432\u0430 \u043F\u043E\u0448\u0442\u0430";
  if (/Розетк|rozetka/i.test(m)) return "\u0420\u043E\u0437\u0435\u0442\u043A\u0430";
  if (/Checkbox/i.test(m)) return "Checkbox";
  if (/Telegram/i.test(m)) return "Telegram";
  if (path.startsWith("/api/an")) return "\u0410\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430";
  if (path.startsWith("/api/odb")) return "Opendatabot";
  if (path.startsWith("/api/invoice") || path.startsWith("/api/rahunok-order")) return "LP-CRM";
  return "\u0421\u0435\u0440\u0432\u0435\u0440";
}
var kindOf = (source, message) => `${source}|${String(message || "").replace(/\d+/g, "#").slice(0, 120)}`;
var h2 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function mountErrLog(app, { db, fetchFn, onCleanup, shared: shared2 = {} }) {
  shared2.errTg ||= { sentAt: /* @__PURE__ */ new Map(), token: "", chats: [], at: 0 };
  const mem = shared2.errTg;
  onCleanup(() => db.run(`DELETE FROM error_log WHERE at < ?`, [new Date(Date.now() - KEEP_DAYS * 864e5).toISOString()]));
  async function recipients() {
    if (Date.now() - mem.at < 10 * 6e4 && mem.token) return mem;
    try {
      const s = await loadSettings(db);
      const rows = await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND role IN ('owner', 'admin', 'admin_lite') AND tg_chat_id != ''`);
      Object.assign(mem, { token: s.tg_token || "", chats: rows.map((r) => r.tg_chat_id), at: Date.now() });
    } catch {
    }
    return mem;
  }
  async function tgOnce(kind, text) {
    const last = mem.sentAt.get(kind) || 0;
    if (Date.now() - last < TG_EVERY_MS) return;
    try {
      const row = await db.get(`SELECT value FROM settings WHERE key = 'err_tg'`);
      const map = row?.value ? JSON.parse(row.value) : {};
      if (Date.now() - (map[kind] || 0) < TG_EVERY_MS) {
        mem.sentAt.set(kind, map[kind]);
        return;
      }
      for (const k of Object.keys(map)) if (Date.now() - map[k] > 24 * 36e5) delete map[k];
      map[kind] = Date.now();
      await db.run(`INSERT INTO settings (key, value) VALUES ('err_tg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(map)]);
    } catch {
    }
    mem.sentAt.set(kind, Date.now());
    const { token, chats } = await recipients();
    if (!token) return;
    for (const chat of chats.slice(0, 10)) {
      try {
        await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true })
        });
      } catch {
      }
    }
  }
  async function log(err, { path = "", user = "", source = "" } = {}) {
    try {
      const message = String(err?.message || err || "").slice(0, 1e3);
      const src = source || errSource(message, path);
      try {
        await db.run(
          `INSERT INTO error_log (at, source, message, path, user_name) VALUES (?, ?, ?, ?, ?)`,
          [(/* @__PURE__ */ new Date()).toISOString(), src, message, String(path).slice(0, 200), String(user).slice(0, 80)]
        );
      } catch {
      }
      await tgOnce(kindOf(src, message), `\u26A0\uFE0F <b>\u041F\u043E\u043C\u0438\u043B\u043A\u0430: ${h2(src)}</b>
${h2(message.slice(0, 500))}${path ? `
<i>${h2(path)}</i>` : ""}${user ? `
\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447: ${h2(user)}` : ""}

\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u0456 \u0442\u0430\u043A\u0456 \u0441\u0430\u043C\u0456 \u2014 \u043D\u0435 \u0447\u0430\u0441\u0442\u0456\u0448\u0435 \u0440\u0430\u0437\u0443 \u043D\u0430 \u0433\u043E\u0434\u0438\u043D\u0443. \u0414\u0435\u0442\u0430\u043B\u0456: \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u2192 \u0416\u0443\u0440\u043D\u0430\u043B \u043F\u043E\u043C\u0438\u043B\u043E\u043A\xBB.`);
    } catch {
    }
  }
  app.get("/api/errors", async (c) => {
    need(c, "users");
    const src = String(c.req.query("source") || "");
    const rows = await db.all(
      `SELECT id, at, source, message, path, user_name FROM error_log ${src ? "WHERE source = ?" : ""} ORDER BY id DESC LIMIT 300`,
      src ? [src] : []
    );
    const sources = await db.all(`SELECT source, COUNT(*) AS n, MAX(at) AS last FROM error_log GROUP BY source ORDER BY last DESC`);
    return c.json({ rows, sources, keepDays: KEEP_DAYS });
  });
  app.delete("/api/errors", async (c) => {
    need(c, "users");
    await db.run(`DELETE FROM error_log`);
    return c.json({ ok: true });
  });
  return { log };
}

// src/modules/b2b/filters.js
function kyivOffsetMin(ms) {
  const s = new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Kyiv" }).replace(" ", "T");
  return Math.round((Date.parse(`${s}Z`) - ms) / 6e4);
}
function kyivDayStartIso(day) {
  const utc0 = Date.parse(`${day}T00:00:00Z`);
  const guess = utc0 - kyivOffsetMin(utc0) * 6e4;
  return new Date(utc0 - kyivOffsetMin(guess) * 6e4).toISOString();
}
var nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
var kyivDayOf = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
var isDay2 = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
var PAID_SQL = `((o.supply_id IS NULL AND COALESCE(o.paid_at, '') != '') OR s.status IN ('paid', 'done'))`;
function listFilter(c, { client = false } = {}) {
  const where = [];
  const params = [];
  const q = String(c.req.query("q") || "").trim().slice(0, 60);
  if (q) {
    const or = [];
    const num4 = /^(?:b2b\s*-?\s*)?(\d{1,9})$/i.exec(q);
    if (num4) {
      or.push("o.id = ?");
      params.push(Number(num4[1]));
    }
    const low2 = q.toLocaleLowerCase("uk");
    const variants = [.../* @__PURE__ */ new Set([
      q,
      low2,
      low2.toLocaleUpperCase("uk"),
      low2.charAt(0).toLocaleUpperCase("uk") + low2.slice(1),
      low2.replace(/(^|[\s«"'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("uk"))
    ])].map((v) => `%${v}%`);
    const anyCase = (col) => {
      or.push(`(${variants.map(() => `${col} LIKE ?`).join(" OR ")})`);
      params.push(...variants);
    };
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, "");
    if (client) {
      anyCase("o.client_name");
      if (digits.length >= 4) {
        or.push("o.client_phone LIKE ?", "o.ttn LIKE ?", "o.crm_id = ?");
        params.push(`%${digits}%`, `%${digits}%`, digits);
      }
    } else {
      anyCase("o.entity");
      or.push("o.invoice_no LIKE ?", "o.waybill_no LIKE ?");
      params.push(like, like);
    }
    where.push(`(${or.join(" OR ")})`);
  }
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (isDay2(from)) {
    where.push("o.created_at >= ?");
    params.push(kyivDayStartIso(from));
  }
  if (isDay2(to)) {
    where.push("o.created_at < ?");
    params.push(kyivDayStartIso(nextDay(to)));
  }
  const pay = c.req.query("pay");
  if (client && pay === "paid") where.push(PAID_SQL);
  if (client && pay === "unpaid") where.push(`NOT ${PAID_SQL}`);
  return { where, params };
}

// src/integrations/pdftext.js
var dec1252 = new TextDecoder("latin1");
var W1252 = new Map([...Array(32)].map((_, i) => [dec1252.decode(new Uint8Array([128 + i])).charCodeAt(0), 128 + i]));
var latin1 = (u8) => dec1252.decode(u8);
var byteAt = (ch) => {
  const c = ch.charCodeAt(0);
  return c < 256 ? c : W1252.get(c) ?? 63;
};
async function inflate(u8) {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter();
  w.write(u8).catch(() => {
  });
  w.close().catch(() => {
  });
  const chunks = [];
  let n = 0;
  const r = ds.readable.getReader();
  try {
    for (; ; ) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
  } catch {
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
function objects(bytes) {
  const s = latin1(bytes);
  const out = /* @__PURE__ */ new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while (m = re.exec(s)) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.indexOf("stream");
    let dict = body;
    let stream = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      let a = start + si + 6;
      if (s[a] === "\r") a++;
      if (s[a] === "\n") a++;
      const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      const direct = lm && !lm[2];
      let b = direct ? a + Number(lm[1]) : s.indexOf("endstream", a);
      if (!direct) while (b > a && (s[b - 1] === "\n" || s[b - 1] === "\r")) b--;
      stream = bytes.subarray(a, b);
    }
    out.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return out;
}
var hexToStr = (hex) => {
  let r = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const c = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(c)) r += String.fromCodePoint(c);
  }
  return r;
};
function parseCMap(txt) {
  const map = /* @__PURE__ */ new Map();
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16);
      const b = parseInt(m[2], 16);
      if (m[3]) {
        const base = parseInt(m[3], 16);
        for (let c = a; c <= b && c - a < 5e3; c++) map.set(c, String.fromCodePoint(base + c - a));
      } else [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, i) => map.set(a + i, hexToStr(x[1])));
    }
  }
  return map;
}
function bytesOf(tokS) {
  const out = [];
  if (tokS[0] === "<") {
    const hx = tokS.slice(1, -1).replace(/\s/g, "");
    for (let i = 0; i < hx.length; i += 2) out.push(parseInt(hx.slice(i, i + 2).padEnd(2, "0"), 16));
    return out;
  }
  const t = tokS.slice(1, -1);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== "\\") {
      out.push(byteAt(ch));
      continue;
    }
    const nx = t[++i];
    if (nx === void 0) break;
    if (/[0-7]/.test(nx)) {
      let o = nx;
      while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i];
      out.push(parseInt(o, 8) & 255);
    } else if (nx === "\n" || nx === "\r") continue;
    else out.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[nx] ?? byteAt(nx));
  }
  return out;
}
var MAX_PDF = 6 * 1024 * 1024;
async function pdfText(bytes) {
  try {
    if (!bytes?.length || bytes.length > MAX_PDF || latin1(bytes.subarray(0, 5)) !== "%PDF-") return "";
    const objs = objects(bytes);
    const dec = async (o) => o.stream ? /FlateDecode/.test(o.dict) ? await inflate(o.stream) : o.stream : null;
    const fontCmap = /* @__PURE__ */ new Map();
    for (const [n, o] of objs) {
      if (!/\/Type\s*\/Font/.test(o.dict)) continue;
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(o.dict);
      const cm = tu && objs.get(Number(tu[1]));
      if (cm) fontCmap.set(n, parseCMap(latin1(await dec(cm))));
    }
    const resName = /* @__PURE__ */ new Map();
    for (const [, o] of objs) {
      const fm = /\/Font\s*<<([^>]*)>>/.exec(o.dict);
      if (fm) for (const m of fm[1].matchAll(/\/(\S+?)\s+(\d+)\s+0\s+R/g)) resName.set(m[1], Number(m[2]));
    }
    const lines = [];
    const tok = /\/(\S+)\s+[\d.]+\s+Tf|([\d.-]+)\s+([\d.-]+)\s+Td|[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)\s+Tm|(<[0-9A-Fa-f\s]*>|\((?:\\[\s\S]|[^\\)])*\))\s*Tj|\[((?:\\[\s\S]|[^\]\\])*)\]\s*TJ|\bT\*|\bET\b/g;
    for (const [, o] of objs) {
      if (!o.stream || /\/(Subtype\s*\/Image|Length1|FontFile|Type\s*\/Font|Type\s*\/XRef|Type\s*\/ObjStm)/.test(o.dict)) continue;
      let content;
      try {
        content = latin1(await dec(o));
      } catch {
        continue;
      }
      if (!/\bTf\b/.test(content)) continue;
      let cmap = null;
      let line = "";
      let lastY = null;
      const flush = () => {
        if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
        line = "";
      };
      const decode = (s) => {
        if (!cmap) return "";
        const b = bytesOf(s);
        let r = "";
        for (let i = 0; i + 1 < b.length; i += 2) r += cmap.get(b[i] << 8 | b[i + 1]) ?? "";
        return r;
      };
      tok.lastIndex = 0;
      let m;
      while (m = tok.exec(content)) {
        if (m[1]) cmap = fontCmap.get(resName.get(m[1])) || null;
        else if (m[3] !== void 0) {
          if (Math.abs(Number(m[3])) > 0.5) flush();
          else line += " ";
        } else if (m[5] !== void 0) {
          const y = Number(m[5]);
          if (lastY !== null && Math.abs(y - lastY) > 2) flush();
          else line += " ";
          lastY = y;
        } else if (m[6] !== void 0) line += decode(m[6]);
        else if (m[7] !== void 0) {
          for (const p of m[7].matchAll(/(<[0-9A-Fa-f\s]*>|\((?:\\[\s\S]|[^\\)])*\))|(-?[\d.]+)/g)) {
            if (p[1] !== void 0) line += decode(p[1]);
            else if (Number(p[2]) < -200) line += " ";
          }
        } else flush();
      }
      flush();
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
var MONTHS = { \u0441\u0456\u0447\u043D\u044F: 1, \u043B\u044E\u0442\u043E\u0433\u043E: 2, \u0431\u0435\u0440\u0435\u0437\u043D\u044F: 3, \u043A\u0432\u0456\u0442\u043D\u044F: 4, \u0442\u0440\u0430\u0432\u043D\u044F: 5, \u0447\u0435\u0440\u0432\u043D\u044F: 6, \u043B\u0438\u043F\u043D\u044F: 7, \u0441\u0435\u0440\u043F\u043D\u044F: 8, \u0432\u0435\u0440\u0435\u0441\u043D\u044F: 9, \u0436\u043E\u0432\u0442\u043D\u044F: 10, \u043B\u0438\u0441\u0442\u043E\u043F\u0430\u0434\u0430: 11, \u0433\u0440\u0443\u0434\u043D\u044F: 12 };
var money = (s) => Number(String(s).replace(/[\s  ]/g, "").replace(",", "."));
var MONEY_RE = /^\d{1,3}(?:[\s  ]\d{3})*,\d{2}$/;
function parseBasDoc(text) {
  const t = String(text || "").replace(/[  ]/g, " ");
  const head = /(Рахунок на оплату|Рахунок-фактура|Рахунок|Видаткова накладна|Накладна)\s*№\s*([\w\-/.]+)\s*від\s*(\d{1,2})\s+([а-яіїєґ']+)\s+(\d{4})/i.exec(t);
  if (!head) return null;
  const total = /Всього:\s*([\d ]+,\d{2})/.exec(t) || /на суму\s*([\d ]+,\d{2})\s*UAH/.exec(t);
  const buyer = /Покупець:\s*([^\n]+)/.exec(t);
  const mon = MONTHS[head[4].toLowerCase()];
  const items = [];
  const lines = t.split("\n").map((x) => x.trim());
  let i = lines.findIndex((x) => /^Сума з ПДВ$/i.test(x));
  if (i >= 0) {
    for (i += 1; i < lines.length; i++) {
      if (/^Всього/.test(lines[i])) break;
      if (!/^\d{1,3}$/.test(lines[i])) continue;
      const name = [];
      let j = i + 1;
      while (j < lines.length && !(/^\d+(?:[.,]\d+)?$/.test(lines[j]) && /^[а-яіїєґa-z.]{1,6}$/i.test(lines[j + 1] || "") && MONEY_RE.test(lines[j + 2] || ""))) {
        if (/^Всього/.test(lines[j])) break;
        name.push(lines[j]);
        j++;
      }
      if (j >= lines.length || /^Всього/.test(lines[j])) break;
      items.push({ n: Number(lines[i]), name: name.join(" ").replace(/\s+/g, " ").trim(), qty: Number(lines[j].replace(",", ".")), price: money(lines[j + 2]), sum: MONEY_RE.test(lines[j + 3] || "") ? money(lines[j + 3]) : null });
      i = j + 3;
    }
  }
  return {
    kind: /накладна/i.test(head[1]) ? "waybill" : "invoice",
    number: head[2].replace(/[.]+$/, ""),
    date: mon ? `${head[5]}-${String(mon).padStart(2, "0")}-${head[3].padStart(2, "0")}` : "",
    total: total ? money(total[1]) : null,
    buyer: buyer ? buyer[1].trim() : "",
    items
  };
}
function parseNpLabel(text) {
  const t = String(text || "");
  const ttn = (/(?<![\d ])((?:20|59)(?:[ \n]?\d){12})(?![ \n]?\d)/.exec(t)?.[1] || "").replace(/\D/g, "");
  const phones = [...t.matchAll(/(?<!\d)(0\d{2})[ -]?(\d{3})[ -]?(\d{2})[ -]?(\d{2})(?!\d)/g)].map((m) => `38${m[1]}${m[2]}${m[3]}${m[4]}`);
  const lines = t.split("\n").map((x) => x.trim());
  let recipient = "";
  let address = "";
  const komu = lines.findIndex((x) => /^КОМУ:?$/i.test(x));
  if (komu >= 0) {
    const after = lines.slice(komu + 1);
    const priv = after.findIndex((x) => /^Приватна особа$/i.test(x));
    if (priv >= 0) {
      const name = [];
      for (const x of after.slice(priv + 1)) {
        if (/Відділення|Поштомат|вул\.|\d{3} \d{3}/i.test(x)) {
          if (/Відділення|Поштомат|вул\./i.test(x)) address = x;
          break;
        }
        name.push(x);
      }
      recipient = name.join(" ").trim();
    }
  }
  return ttn ? { ttn, phone: phones.at(-1) || "", recipient, address, rozetka: /РОЗ\s?(\d{6,})/.exec(t)?.[1] || "" } : null;
}
function hintsOf(str) {
  const s = String(str || "");
  const order2 = /B2B[\s-]*(\d{1,9})/i.exec(s)?.[1];
  const kind = /накладн|\bрн\b|\bвн\b/i.test(s) ? "waybill" : /рахун|\bсф\b|invoice/i.test(s) ? "invoice" : "";
  const number = /(?:№|N|#|номер)\s*([A-Za-zА-Яа-яІЇЄ]{0,4}-?\d{1,10})/i.exec(s)?.[1] || "";
  return { order: order2 ? Number(order2) : null, kind, number };
}
function nameKey(s) {
  return String(s || "").toLowerCase().replace(/товариство з обмеженою відповідальністю|приватне підприємство|фізична особа[\s-]*підприємець/g, " ").replace(/[«»"'’`.,()]/g, " ").split(/\s+/).filter((w) => w && !["\u0442\u043E\u0432", "\u0444\u043E\u043F", "\u043F\u043F", "\u0444\u043E-\u043F", "\u0444\u043E\u043F-"].includes(w)).sort().join(" ");
}
function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = new Set(x.split(" "));
  const ys = y.split(" ");
  const common = ys.filter((w) => xs.has(w)).length;
  return common >= Math.min(2, Math.min(xs.size, ys.length)) && common >= Math.min(xs.size, ys.length) * 0.66;
}
var modelTokens = (s) => new Set(String(s || "").toLowerCase().replace(/\[\d+\]/g, " ").split(/[^a-z0-9а-яіїєґ]+/i).filter((w) => w.length >= 2 && (/[a-z]/.test(w) || /\d/.test(w)) && !["wi", "fi", "uv", "hepa", "smart", "true", "mod", "auto"].includes(w)));

// src/modules/b2b/orders.js
var ORDER_STATUS = {
  draft: "\u0427\u0435\u0440\u043D\u0435\u0442\u043A\u0430",
  open: "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0430 (\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0435 \u0441\u0444\u043E\u0440\u043C\u043E\u0432\u0430\u043D\u043E)",
  invoice_wait: "\u041E\u0447\u0456\u043A\u0443\u0454 \u0440\u0430\u0445\u0443\u043D\u043E\u043A",
  pay_wait: "\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443",
  partial: "\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E",
  paid: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E",
  done: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E",
  cancelled: "\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E"
};
var CLIENT_STATUS = {
  new: "\u041D\u043E\u0432\u0435",
  crm: "\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0432 CRM",
  cancelled: "\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E"
};
var ANY_STATUS = { ...ORDER_STATUS, ...CLIENT_STATUS };
function payState(o) {
  if (o.kind !== "client") return "";
  if (!o.supply_id) return o.paid_at ? "paid" : "unpaid";
  if (["paid", "done"].includes(o.supply_status)) return "paid";
  if (o.supply_status === "partial") return "partial";
  return "unpaid";
}
var PAY_NAME = { paid: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", partial: "\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", unpaid: "\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0456 \u043E\u043F\u043B\u0430\u0442\u0438" };
var DEFAULT_LIMITS = { open: 2e4, unpaid: 1e5 };
var limitsOf = (p) => ({
  open: Number(p?.open_limit) > 0 ? Number(p.open_limit) : DEFAULT_LIMITS.open,
  unpaid: Number(p?.unpaid_limit) > 0 ? Number(p.unpaid_limit) : DEFAULT_LIMITS.unpaid
});
var UNPAID = `('open', 'invoice_wait', 'pay_wait', 'partial')`;
var DEBT = `('pay_wait', 'partial')`;
var SHIP_NOINV = `('open', 'invoice_wait')`;
var today = () => kyivDayOf((/* @__PURE__ */ new Date()).toISOString());
var addDaysTo = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
var overdueDays = (o) => o.due_date && ["pay_wait", "partial"].includes(o.status) && o.due_date < today() ? Math.round((Date.parse(`${today()}T12:00:00Z`) - Date.parse(`${o.due_date}T12:00:00Z`)) / 864e5) : 0;
var CLOSED_SQL = `(o.kind = 'supply' AND o.status NOT IN ('open', 'cancelled', 'draft')
  AND EXISTS (SELECT 1 FROM b2b_order_items i WHERE i.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM b2b_order_items i WHERE i.order_id = o.id AND i.qty > COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci
    JOIN b2b_orders co ON co.id = ci.order_id WHERE co.supply_id = o.id AND co.kind = 'client' AND co.status != 'cancelled' AND ci.product_id = i.product_id), 0)))`;
var DELIVERY = { np: "\u0412\u0456\u0434\u043F\u0440\u0430\u0432\u043A\u0430 \u043A\u043B\u0456\u0454\u043D\u0442\u0430\u043C (\u041D\u043E\u0432\u0430 \u043F\u043E\u0448\u0442\u0430)", pickup: "\u0421\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437 \u2014 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0437\u0430\u0431\u0438\u0440\u0430\u0454 \u0432\u0441\u044E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u0456 \u0441\u043A\u043B\u0430\u0434\u0443" };
var deliveryOf = (v) => DELIVERY[v] ? v : "np";
var LIST_STATUSES = { ...ORDER_STATUS, closed: "\u0417\u0430\u043A\u0440\u0438\u0442\u043E (\u0443\u0441\u0435 \u0440\u043E\u0437\u043F\u0438\u0441\u0430\u043D\u043E)" };
var ENTITY_KIND = { fop: "\u0424\u041E\u041F", tov: "\u0422\u041E\u0412", other: "\u0406\u043D\u0448\u0430 \u044E\u0440\u043E\u0441\u043E\u0431\u0430" };
var FILE_KIND = { invoice: "\u0420\u0430\u0445\u0443\u043D\u043E\u043A", waybill: "\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430", label: "\u041C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F", doc: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442", other: "\u0424\u0430\u0439\u043B" };
var MAX_FILE = 5 * 1024 * 1024;
var PART = 600 * 1024;
var KEEP_FILES_DAYS = 30;
var h3 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var nf2 = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var uah2 = (n) => `${nf2.format(Number(n) || 0)} \u0433\u0440\u043D`;
var orderNo = (id) => `B2B-${id}`;
function toB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}
var fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
var userName2 = (u) => u?.name || u?.login || "";
function mountB2bOrders(app, { db, services, myPartner, partnerPrice: partnerPrice2, onCleanup, hooks = {} }) {
  onCleanup(async () => {
    const t = today();
    const rows = await db.all(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
      WHERE o.kind = 'supply' AND o.status IN ${DEBT} AND o.due_date != '' AND o.due_date <= ? LIMIT 50`, [addDaysTo(t, 1)]);
    for (const o of rows) {
      const left = round2(o.total - o.paid_amount);
      const late = overdueDays(o);
      const last = String(o.due_notified || "");
      let text = "";
      if (!late && o.due_date > t && last !== "pre") text = `\u23F0 <b>\u0417\u0430\u0432\u0442\u0440\u0430 \u0441\u0442\u0440\u043E\u043A \u043E\u043F\u043B\u0430\u0442\u0438</b> \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(o.id)}${o.invoice_no ? ` (\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h3(o.invoice_no)})` : ""}: ${uah2(left)}`;
      else if (late && (!last.startsWith("over:") || addDaysTo(last.slice(5), 7) <= t)) text = `\u{1F534} <b>\u041F\u0440\u043E\u0441\u0442\u0440\u043E\u0447\u0435\u043D\u043E \u043E\u043F\u043B\u0430\u0442\u0443</b> \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(o.id)}${o.invoice_no ? ` (\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h3(o.invoice_no)})` : ""} \u043D\u0430 ${late} \u0434\u043D.: ${uah2(left)}`;
      if (!text) continue;
      await db.run(`UPDATE b2b_orders SET due_notified = ? WHERE id = ?`, [late ? `over:${t}` : "pre", o.id]);
      await tgPartner(o.partner_id, text);
      await tgAdmins(`${text} \u2014 \xAB${h3(o.partner)}\xBB`);
    }
  });
  onCleanup(async () => {
    const border = new Date(Date.now() - KEEP_FILES_DAYS * 864e5).toISOString();
    await db.batch([
      [`DELETE FROM b2b_file_parts WHERE file_id IN (SELECT id FROM b2b_files WHERE created_at < ?)`, [border]],
      [`DELETE FROM b2b_files WHERE created_at < ?`, [border]]
    ]);
  });
  const log = (orderId, user, action) => db.run(
    `INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
    [orderId, nowIso(), userName2(user), action]
  );
  const tgAdmins = (text) => services.notify?.sendText({ admins: true }, text).catch(() => 0);
  const groupOf = async (partnerId) => (await db.get(`SELECT tg_group FROM b2b_partners WHERE id = ?`, [partnerId]))?.tg_group || "";
  const tgPartner = async (partnerId, text) => services.notify?.sendText({ partnerId }, text).catch(() => 0);
  const tgGroup = async (partnerId, text) => {
    const g = await groupOf(partnerId);
    return g ? services.notify?.sendText({ chatIds: [g] }, text).catch(() => 0) : 0;
  };
  const orderText = (title, o, p, items) => {
    const lines = items.slice(0, 60).map((i) => `${h3(i.name)}${i.article ? ` (${h3(i.article)})` : ""} \u2014 ${i.qty} \u0448\u0442 \u2014 ${uah2(i.price)}`);
    if (items.length > 60) lines.push(`\u2026\u0456 \u0449\u0435 ${items.length - 60} \u043F\u043E\u0437.`);
    return `${title} <b>${orderNo(o.id)}</b> \u0432\u0456\u0434 \xAB${h3(p.name)}\xBB

<b>\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u0456 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 \u043D\u0430:</b>
${h3(o.entity || "\u2014")}
<b>\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430:</b> ${o.delivery === "pickup" ? "\u{1F697} <b>\u0421\u0410\u041C\u041E\u0412\u0418\u0412\u0406\u0417</b> \u2014 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0437\u0430\u0431\u0438\u0440\u0430\u0454 \u0432\u0441\u044E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u0456 \u0441\u043A\u043B\u0430\u0434\u0443" : "\u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043A\u0430 \u043A\u043B\u0456\u0454\u043D\u0442\u0430\u043C (\u041D\u043E\u0432\u0430 \u043F\u043E\u0448\u0442\u0430)"}
${o.pay_terms === "postpay" ? `<b>\u041E\u043F\u043B\u0430\u0442\u0430:</b> \u23F3 <b>\u0412\u0406\u0414\u0421\u0422\u0420\u041E\u0427\u041A\u0410 ${o.pay_days} \u0434\u043D.</b> \u0432\u0456\u0434 \u0434\u0430\u0442\u0438 \u0440\u0430\u0445\u0443\u043D\u043A\u0443
` : ""}
<b>\u0422\u043E\u0432\u0430\u0440\u0438:</b>
${lines.join("\n")}

<b>\u0420\u0430\u0437\u043E\u043C: ${uah2(o.total)}</b> (\u0437 \u041F\u0414\u0412)${o.comment ? `

<i>\u041A\u043E\u043C\u0435\u043D\u0442\u0430\u0440: ${h3(String(o.comment).slice(0, 300))}</i>` : ""}`;
  };
  const link = (c, hash2) => `${typeof c === "string" ? c : new URL(c.req.url).origin}/#/${hash2}`;
  function entityFields(b) {
    const kind = ENTITY_KIND[b.kind] ? b.kind : "fop";
    const code = String(b.code ?? "").replace(/\s/g, "");
    const iban = String(b.iban ?? "").replace(/\s/g, "").toUpperCase();
    const f = {
      kind,
      code,
      iban,
      name: String(b.name ?? "").trim().slice(0, 200),
      address: String(b.address ?? "").trim().slice(0, 300),
      phone: String(b.phone ?? "").trim().slice(0, 40),
      email: String(b.email ?? "").trim().slice(0, 120),
      vat: b.vat ? 1 : 0
    };
    if (!f.name) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043D\u0430\u0437\u0432\u0443 \u044E\u0440\u043E\u0441\u043E\u0431\u0438 (\u044F\u043A \u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u0445).");
    if (!/^(\d{8}|\d{10})$/.test(code)) throw fail(400, "\u041A\u043E\u0434: \u0404\u0414\u0420\u041F\u041E\u0423 \u2014 8 \u0446\u0438\u0444\u0440, \u0406\u041F\u041D (\u0420\u041D\u041E\u041A\u041F\u041F) \u0424\u041E\u041F \u2014 10 \u0446\u0438\u0444\u0440.");
    if (iban && !/^UA\d{27}$/.test(iban)) throw fail(400, "IBAN: UA \u0456 27 \u0446\u0438\u0444\u0440 (\u043C\u043E\u0436\u043D\u0430 \u0437\u0430\u043B\u0438\u0448\u0438\u0442\u0438 \u043F\u043E\u0440\u043E\u0436\u043D\u0456\u043C).");
    return f;
  }
  app.get("/api/b2b/p/entities", async (c) => {
    const p = await myPartner(c);
    const rows = await db.all(`SELECT * FROM b2b_entities WHERE partner_id = ? AND active = 1 ORDER BY name`, [p.id]);
    const def = Number(p.default_entity) || 0;
    return c.json(rows.map((e) => ({ ...e, is_default: e.id === def })).sort((a, b) => Number(b.is_default) - Number(a.is_default)));
  });
  app.post("/api/b2b/p/entities/:id/default", async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param("id"));
    const on = (await c.req.json().catch(() => ({}))).on !== false;
    await db.run(`UPDATE b2b_partners SET default_entity = ? WHERE id = ?`, [on ? e.id : null, p.id]);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/p/entities", async (c) => {
    const p = await myPartner(c);
    const f = entityFields(await c.req.json());
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_entities WHERE partner_id = ? AND active = 1`, [p.id])).n >= 50) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 50 \u044E\u0440\u043E\u0441\u0456\u0431.");
    const r = await db.run(
      `INSERT INTO b2b_entities (partner_id, kind, name, code, address, iban, phone, email, vat, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [p.id, f.kind, f.name, f.code, f.address, f.iban, f.phone, f.email, f.vat, nowIso()]
    );
    return c.json({ id: r.lastId });
  });
  async function myEntity(p, id) {
    const e = await db.get(`SELECT * FROM b2b_entities WHERE id = ? AND partner_id = ? AND active = 1`, [id, p.id]);
    if (!e) throw fail(404, "\u042E\u0440\u043E\u0441\u043E\u0431\u0443 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return e;
  }
  app.put("/api/b2b/p/entities/:id", async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param("id"));
    const f = entityFields(await c.req.json());
    await db.run(
      `UPDATE b2b_entities SET kind = ?, name = ?, code = ?, address = ?, iban = ?, phone = ?, email = ?, vat = ? WHERE id = ?`,
      [f.kind, f.name, f.code, f.address, f.iban, f.phone, f.email, f.vat, e.id]
    );
    return c.json({ ok: true });
  });
  app.delete("/api/b2b/p/entities/:id", async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param("id"));
    const used = await db.get(`SELECT id FROM b2b_orders WHERE entity_id = ? LIMIT 1`, [e.id]);
    if (used) await db.run(`UPDATE b2b_entities SET active = 0 WHERE id = ?`, [e.id]);
    else await db.run(`DELETE FROM b2b_entities WHERE id = ?`, [e.id]);
    return c.json({ ok: true });
  });
  const entityText = (e) => `${e.name}, ${e.code.length === 8 ? "\u0404\u0414\u0420\u041F\u041E\u0423" : "\u0406\u041F\u041D"} ${e.code}${e.vat ? ", \u043F\u043B\u0430\u0442\u043D\u0438\u043A \u041F\u0414\u0412" : ""}${e.address ? `
${e.address}` : ""}${e.iban ? `
IBAN ${e.iban}` : ""}${e.phone ? `
\u0422\u0435\u043B. ${e.phone}` : ""}${e.email ? `
${e.email}` : ""}`;
  async function priceItems(p, items) {
    const want = /* @__PURE__ */ new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id || !Number.isInteger(qty) || qty <= 0) continue;
      if (qty > 1e5) throw fail(400, "\u041A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0430.");
      want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw fail(400, "\u0414\u043E\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0442\u043E\u0432\u0430\u0440 \u0456\u0437 \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044E.");
    if (want.size > 300) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 300 \u043F\u043E\u0437\u0438\u0446\u0456\u0439 \u0432 \u043E\u0434\u043D\u043E\u043C\u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456.");
    const rows = await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, m.margin FROM b2b_catalog c JOIN b2b_margins m ON m.brand_id = c.brand_id AND m.partner_id = ?
       WHERE c.product_id IN (SELECT value FROM json_each(?)) AND c.hidden = 0 AND c.rrp > 0`,
      [p.id, JSON.stringify([...want.keys()])]
    );
    if (rows.length !== want.size) throw fail(400, "\u0414\u0435\u044F\u043A\u0456 \u0442\u043E\u0432\u0430\u0440\u0438 \u0431\u0456\u043B\u044C\u0448\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0456 \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443.");
    return rows.map((r) => ({ product_id: r.product_id, name: r.name, article: r.article || "", qty: want.get(r.product_id), price: partnerPrice2(r.rrp, r.margin), rrp: r.rrp }));
  }
  const totalOf = (items) => round2(items.reduce((t, i) => t + round2(i.price * i.qty), 0));
  const itemRows = (orderId, items) => items.map((i) => [
    `INSERT INTO b2b_order_items (order_id, product_id, name, article, qty, price, rrp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderId, i.product_id, i.name, i.article, i.qty, i.price, i.rrp]
  ]);
  const isHead = (c) => can(c.get("user"), "b2b.team");
  app.post("/api/b2b/p/orders", async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const toDraft = parseInt(b.to_draft, 10) || 0;
    if (toDraft) {
      const d = await orderOf(toDraft, p.id);
      if (d.kind !== "supply" || d.status !== "draft") throw fail(400, "\u0427\u0435\u0440\u043D\u0435\u0442\u043A\u0443 \u0432\u0436\u0435 \u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0430\u0431\u043E \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443.");
      const have = await db.all(`SELECT product_id, qty FROM b2b_order_items WHERE order_id = ?`, [d.id]);
      const sum = new Map(have.map((i) => [i.product_id, i.qty]));
      const add = (Array.isArray(b.items) ? b.items : []).filter((i) => Number(i.qty) > 0);
      if (!add.length) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u043D\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0443.");
      for (const i of add) sum.set(Number(i.product_id), (sum.get(Number(i.product_id)) || 0) + Math.floor(Number(i.qty)));
      const items2 = await priceItems(p, [...sum].map(([product_id, qty]) => ({ product_id, qty })));
      const total2 = totalOf(items2);
      await db.batch([
        [`DELETE FROM b2b_order_items WHERE order_id = ?`, [d.id]],
        ...itemRows(d.id, items2),
        [`UPDATE b2b_orders SET total = ?, updated_at = ? WHERE id = ?`, [total2, nowIso(), d.id]]
      ]);
      await log(d.id, c.get("user"), `\u0434\u043E\u0434\u0430\u043D\u043E \u0434\u043E \u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0438: ${add.length} \u043F\u043E\u0437. (\u0440\u0430\u0437\u043E\u043C ${uah2(total2)})`);
      return c.json({ id: d.id, number: orderNo(d.id), total: total2, draft: true });
    }
    const draft = Boolean(b.draft) || !isHead(c);
    const e = await myEntity(p, b.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const terms = termsOf(b);
    if (terms === "postpay" && !(Number(p.postpay_days) > 0)) throw fail(403, "\u0412\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0443 \u043E\u043F\u043B\u0430\u0442\u0438 \u0432\u0430\u043C \u0449\u0435 \u043D\u0435 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E \u2014 \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.");
    if (!draft) await checkTerms(p, terms, total);
    const payDays = terms === "postpay" ? Number(p.postpay_days) : 0;
    const now = nowIso();
    if (draft) {
      const r2 = await db.run(
        `INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at, delivery, pay_terms, pay_days) VALUES (?, 'supply', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, e.id, entityText(e), total, String(b.comment || "").trim().slice(0, 1e3), userName2(c.get("user")), now, now, deliveryOf(b.delivery), terms, payDays]
      );
      await db.batch([...itemRows(r2.lastId, items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [r2.lastId, now, userName2(c.get("user")), `\u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E \u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0443 \u043D\u0430 ${uah2(total)}`]]]);
      return c.json({ id: r2.lastId, number: orderNo(r2.lastId), total, draft: true });
    }
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at, delivery, pay_terms, pay_days) VALUES (?, 'supply', 'invoice_wait', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, e.id, entityText(e), total, String(b.comment || "").trim().slice(0, 1e3), userName2(c.get("user")), now, now, deliveryOf(b.delivery), terms, payDays]
    );
    await db.batch([...itemRows(r.lastId, items), [
      `INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
      [r.lastId, now, userName2(c.get("user")), `\u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u043D\u0430 ${uah2(total)}${deliveryOf(b.delivery) === "pickup" ? " (\u0441\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437)" : ""}`]
    ]]);
    const full = orderText("\u{1F195} \u041D\u043E\u0432\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F", { id: r.lastId, entity: entityText(e), total, comment: b.comment, delivery: deliveryOf(b.delivery), pay_terms: terms, pay_days: payDays }, p, items);
    await tgAdmins(`${full}

${link(c, `b2borders/${r.lastId}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(r.lastId).catch(() => 0);
    return c.json({ id: r.lastId, number: orderNo(r.lastId), total });
  });
  async function unpaidTotal(partnerId, exceptId = 0) {
    const r = await db.get(`SELECT COALESCE(SUM(total - paid_amount), 0) AS t FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${UNPAID}
      AND COALESCE(pay_terms, 'prepay') != 'postpay' AND id != ?`, [partnerId, exceptId]);
    return round2(r?.t || 0);
  }
  async function postpayInfo(p, exceptId = 0) {
    const days = Number(p.postpay_days) || 0;
    const [used, overdue] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(total - paid_amount), 0) AS t FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${UNPAID}
        AND pay_terms = 'postpay' AND id != ?`, [p.id, exceptId]),
      db.all(`SELECT id, total, paid_amount, due_date, status FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${DEBT}
        AND due_date != '' AND due_date < ?`, [p.id, today()])
    ]);
    return {
      days,
      limit: Number(p.postpay_limit) > 0 ? Number(p.postpay_limit) : null,
      used: round2(used?.t || 0),
      overdue: overdue.map((o) => ({ id: o.id, number: orderNo(o.id), due: round2(o.total - o.paid_amount), due_date: o.due_date, days: overdueDays(o) }))
    };
  }
  async function checkTerms(p, terms, total, exceptId = 0) {
    if (terms !== "postpay") return checkUnpaid(p, total, exceptId);
    const pi = await postpayInfo(p, exceptId);
    if (!pi.days) throw fail(403, "\u0412\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0443 \u043E\u043F\u043B\u0430\u0442\u0438 \u0432\u0430\u043C \u0449\u0435 \u043D\u0435 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E \u2014 \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.");
    if (pi.overdue.length) throw fail(400, `\u0404 \u043F\u0440\u043E\u0441\u0442\u0440\u043E\u0447\u0435\u043D\u0430 \u043E\u043F\u043B\u0430\u0442\u0430 (${pi.overdue.map((x) => x.number).join(", ")}) \u2014 \u043D\u043E\u0432\u0456 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0437 \u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u043E\u044E \u043F\u0456\u0441\u043B\u044F \u0457\u0457 \u043E\u043F\u043B\u0430\u0442\u0438.`);
    if (pi.limit != null && pi.used + total > pi.limit + 4e-3) {
      throw fail(400, `\u041B\u0456\u043C\u0456\u0442 \u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0438 \u2014 ${uah2(pi.limit)}: \u0437\u0430\u0440\u0430\u0437 \u0437\u0430 \u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u043E\u044E ${uah2(pi.used)}, \u043D\u043E\u0432\u0430 \u0441\u0443\u043C\u0430 ${uah2(total)}.`);
    }
    return null;
  }
  const termsOf = (b, o = null) => b.pay_terms === void 0 ? o?.pay_terms === "postpay" ? "postpay" : "prepay" : b.pay_terms === "postpay" ? "postpay" : "prepay";
  async function checkUnpaid(p, addTotal, exceptId = 0) {
    const lim = limitsOf(p).unpaid;
    const cur = await unpaidTotal(p.id, exceptId);
    if (cur + addTotal > lim + 4e-3) {
      throw fail(400, `\u041B\u0456\u043C\u0456\u0442 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0438\u0445 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u0435\u043B\u044C \u2014 ${uah2(lim)}: \u0437\u0430\u0440\u0430\u0437 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ${uah2(cur)}, \u043D\u043E\u0432\u0430 \u0441\u0443\u043C\u0430 ${uah2(addTotal)}. \u0421\u043F\u0435\u0440\u0448\u0443 \u043E\u043F\u043B\u0430\u0442\u0456\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0430\u0431\u043E \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.`);
    }
  }
  async function debtOf(partnerId) {
    const [rows, ship] = await Promise.all([
      db.all(`SELECT id, status, total, paid_amount, invoice_no, invoice_date, due_date, pay_terms, created_at FROM b2b_orders
        WHERE partner_id = ? AND kind = 'supply' AND status IN ${DEBT} ORDER BY COALESCE(NULLIF(due_date, ''), invoice_date, created_at), id`, [partnerId]),
      db.all(`SELECT s.id, s.status, COUNT(co.id) AS n, SUM(co.total) AS sum FROM b2b_orders s
        JOIN b2b_orders co ON co.supply_id = s.id AND co.kind = 'client' AND co.status = 'crm'
        WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status IN ${SHIP_NOINV} GROUP BY s.id ORDER BY s.id`, [partnerId])
    ]);
    const list = rows.map((o) => ({ ...o, number: orderNo(o.id), due: round2(o.total - o.paid_amount), overdue: overdueDays(o) }));
    const shipped = ship.map((s) => ({ id: s.id, number: orderNo(s.id), status: s.status, open: s.status === "open", orders: s.n, sum: round2(s.sum || 0) }));
    const invoiced = round2(list.reduce((t, o) => t + o.due, 0));
    const shippedTotal = round2(shipped.reduce((t, s) => t + s.sum, 0));
    return { total: round2(invoiced + shippedTotal), invoiced, shippedTotal, overdue: round2(list.filter((o) => o.overdue).reduce((t, o) => t + o.due, 0)), rows: list, shipped };
  }
  const getOpen = (partnerId) => db.get(`SELECT * FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status = 'open' ORDER BY id LIMIT 1`, [partnerId]);
  async function rebuildOpen(supplyId) {
    const s = await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [supplyId]);
    if (!s || s.status !== "open") return;
    const rows = await db.all(
      `SELECT i.product_id, MAX(i.name) AS name, MAX(i.article) AS article, i.price, MAX(i.rrp) AS rrp, SUM(i.qty) AS qty
       FROM b2b_order_items i JOIN b2b_orders co ON co.id = i.order_id
       WHERE co.supply_id = ? AND co.kind = 'client' AND co.status != 'cancelled' GROUP BY i.product_id, i.price ORDER BY MIN(i.id)`,
      [s.id]
    );
    if (!rows.length) {
      await db.batch([
        [`DELETE FROM b2b_order_items WHERE order_id = ?`, [s.id]],
        [`DELETE FROM b2b_order_log WHERE order_id = ?`, [s.id]],
        [`UPDATE b2b_orders SET supply_id = NULL WHERE supply_id = ?`, [s.id]],
        [`DELETE FROM b2b_orders WHERE id = ?`, [s.id]]
      ]);
      return;
    }
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [s.id]],
      ...itemRows(s.id, rows),
      [`UPDATE b2b_orders SET total = ?, updated_at = ? WHERE id = ?`, [totalOf(rows), nowIso(), s.id]]
    ]);
  }
  app.get("/api/b2b/p/limits", async (c) => {
    const p = await myPartner(c);
    const lim = limitsOf(p);
    const open = await getOpen(p.id);
    const cnt = open ? (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [open.id])).n : 0;
    return c.json({
      open: { id: open?.id || null, number: open ? orderNo(open.id) : "", total: open?.total || 0, limit: lim.open, orders: cnt },
      unpaid: { total: await unpaidTotal(p.id), limit: lim.unpaid },
      postpay: await postpayInfo(p),
      debt: await debtOf(p.id),
      paused: p.paused ? { note: p.pause_note || "" } : null
    });
  });
  app.post("/api/b2b/p/open/form", async (c) => {
    const p = await myPartner(c);
    const open = await getOpen(p.id);
    if (!open) throw fail(400, "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u043E\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u043D\u0435\u043C\u0430\u0454.");
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id);
    const now = nowIso();
    await db.run(
      `UPDATE b2b_orders SET status = 'invoice_wait', entity_id = ?, entity = ?, comment = ?, updated_at = ? WHERE id = ?`,
      [e.id, entityText(e), String(b.comment || "").trim().slice(0, 1e3), now, open.id]
    );
    await log(open.id, c.get("user"), `\u0441\u0444\u043E\u0440\u043C\u043E\u0432\u0430\u043D\u043E \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0443 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E: ${uah2(open.total)}, \u044E\u0440\u043E\u0441\u043E\u0431\u0430 ${e.name}`);
    const items = await db.all(`SELECT product_id, name, article, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [open.id]);
    const full = orderText("\u{1F195} \u0421\u0444\u043E\u0440\u043C\u043E\u0432\u0430\u043D\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E (\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432)", { id: open.id, entity: entityText(e), total: open.total, comment: b.comment }, p, items);
    await tgAdmins(`${full}

${link(c, `b2borders/${open.id}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(open.id).catch(() => 0);
    return c.json({ ok: true, id: open.id, number: orderNo(open.id) });
  });
  async function orderOf(id, partnerId = null) {
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ? ${partnerId ? "AND partner_id = ?" : ""}`, partnerId ? [id, partnerId] : [id]);
    if (!o) throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return o;
  }
  const publicOrder = (o) => {
    const out = { ...o, number: orderNo(o.id), status_name: ANY_STATUS[o.status] || o.status };
    if (o.kind === "supply") {
      out.delivery = deliveryOf(o.delivery);
      out.delivery_name = DELIVERY[out.delivery];
    }
    if (o.kind === "supply" && ["partial", "pay_wait"].includes(o.status)) out.due = round2(o.total - (o.paid_amount || 0));
    if (o.kind === "supply" && o.status === "partial") out.status_name = `\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E \xB7 \u0449\u0435 ${uah2(out.due)}`;
    if (o.kind === "supply" && o.closed) {
      out.closed = true;
      out.status_name = `${out.status_name} \xB7 \u0417\u0430\u043A\u0440\u0438\u0442\u043E`;
    }
    if (o.kind === "supply") {
      out.pay_terms = o.pay_terms === "postpay" ? "postpay" : "prepay";
      out.overdue = overdueDays(o);
      if (out.overdue) out.status_name = `${out.status_name} \xB7 \u043F\u0440\u043E\u0441\u0442\u0440\u043E\u0447\u0435\u043D\u043E ${out.overdue} \u0434\u043D.`;
    }
    if (o.kind === "client") {
      let pend = null;
      if (o.pending) {
        try {
          const x = JSON.parse(o.pending);
          pend = { changes: x.changes || [], by: x.by || "", at: x.at || "", crm_old: x.crm_old || "" };
        } catch {
          pend = { changes: [] };
        }
      }
      out.pending = pend;
    }
    if (o.kind === "client") Object.assign(out, { no_supply: !o.supply_id || o.supply_status === "open", open_supply: o.supply_status === "open", pay: payState(o), pay_name: PAY_NAME[payState(o)], supply_number: o.supply_id ? orderNo(o.supply_id) : "" });
    return out;
  };
  async function supplyLeft(supplyId, exceptId = 0) {
    return db.all(
      `SELECT i.product_id, i.name, i.article, i.price, i.rrp, i.qty,
        COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
          WHERE co.supply_id = i.order_id AND co.kind = 'client' AND co.status != 'cancelled' AND co.id != ? AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_order_items i WHERE i.order_id = ? ORDER BY i.id`,
      [exceptId, supplyId]
    ).then((rows) => rows.map((r) => ({ ...r, left: r.qty - r.used })));
  }
  async function orderDetail(o) {
    if (o.kind === "client" && o.supply_id && o.supply_status === void 0) {
      o = { ...o, supply_status: (await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [o.supply_id]))?.status || "" };
    }
    const [items, files, history, clients] = await Promise.all([
      db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.all(`SELECT f.id, f.kind, f.name, f.mime, f.size, f.created_by, f.created_at, f.doc_type, t.name AS doc_name
        FROM b2b_files f LEFT JOIN b2b_doc_types t ON t.id = f.doc_type WHERE f.order_id = ? ORDER BY f.id`, [o.id]),
      db.all(`SELECT at, user_name, action FROM b2b_order_log WHERE order_id = ? ORDER BY id DESC LIMIT 100`, [o.id]),
      o.kind === "supply" ? db.all(`SELECT id, status, client_name, total, created_at FROM b2b_orders WHERE supply_id = ? AND kind = 'client' ORDER BY id DESC`, [o.id]) : []
    ]);
    const out = { order: publicOrder(o), items, files: files.map((f) => ({ ...f, kind_name: f.doc_name || FILE_KIND[f.kind] || f.kind })), history };
    if (o.kind === "supply") {
      out.clients = clients.map((x) => ({ ...x, number: orderNo(x.id), status_name: CLIENT_STATUS[x.status] || x.status }));
      out.left = clients.length ? await supplyLeft(o.id) : items.map((i) => ({ ...i, used: 0, left: i.qty }));
      if (!["open", "cancelled"].includes(o.status) && out.left.length && out.left.every((l) => l.left <= 0)) out.order = publicOrder({ ...o, closed: 1 });
    }
    return out;
  }
  app.get("/api/b2b/p/orders", async (c) => {
    const p = await myPartner(c);
    const f = listFilter(c);
    const st = c.req.query("status");
    if (st === "closed") f.where.push(CLOSED_SQL);
    else if (st && ORDER_STATUS[st]) {
      f.where.push("o.status = ?");
      f.params.push(st);
    }
    const rows = await db.all(
      `SELECT o.*, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files, ${CLOSED_SQL} AS closed FROM b2b_orders o
       WHERE o.partner_id = ? AND o.kind = 'supply' ${f.where.map((w) => `AND ${w}`).join(" ")} ORDER BY o.id DESC LIMIT 300`,
      [p.id, ...f.params]
    );
    return c.json({ rows: rows.map(publicOrder), statuses: LIST_STATUSES });
  });
  app.get("/api/b2b/p/orders/:id", async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param("id"), p.id);
    if (o.kind !== "supply") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return c.json(await orderDetail(o));
  });
  app.put("/api/b2b/p/orders/:id", async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param("id"), p.id);
    if (o.kind !== "supply") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (!["invoice_wait", "draft"].includes(o.status)) throw fail(400, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u0443\u0436\u0435 \u0432\u0438\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u2014 \u0437\u043C\u0456\u043D\u0438\u0442\u0438 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440.");
    const isDraft = o.status === "draft";
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id ?? o.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const terms = termsOf(b, o);
    if (terms === "postpay" && !(Number(p.postpay_days) > 0)) throw fail(403, "\u0412\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0443 \u043E\u043F\u043B\u0430\u0442\u0438 \u0432\u0430\u043C \u0449\u0435 \u043D\u0435 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E \u2014 \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.");
    if (!isDraft) await checkTerms(p, terms, total, o.id);
    const payDays = terms === "postpay" ? o.pay_terms === "postpay" && o.pay_days ? o.pay_days : Number(p.postpay_days) : 0;
    const want = new Map(items.map((i) => [i.product_id, i.qty]));
    const left = await supplyLeft(o.id);
    for (const r of left) {
      if (r.used > (want.get(r.product_id) || 0)) throw fail(400, `\xAB${r.name}\xBB: \u043D\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u0443\u0436\u0435 \u0440\u043E\u0437\u043F\u0438\u0441\u0430\u043D\u043E ${r.used} \u0448\u0442. \u2014 \u043C\u0435\u043D\u0448\u0435 \u0437\u043C\u0435\u043D\u0448\u0438\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430.`);
    }
    const delivery = b.delivery === void 0 ? deliveryOf(o.delivery) : deliveryOf(b.delivery);
    if (delivery === "pickup" && left.some((r) => r.used > 0)) throw fail(400, "\u0417 \u0446\u0456\u0454\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0432\u0436\u0435 \u0454 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u2014 \u0441\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437 \u043D\u0435\u043C\u043E\u0436\u043B\u0438\u0432\u0438\u0439.");
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, items),
      [
        `UPDATE b2b_orders SET entity_id = ?, entity = ?, total = ?, comment = ?, delivery = ?, pay_terms = ?, pay_days = ?, updated_at = ? WHERE id = ?`,
        [e.id, entityText(e), total, String(b.comment ?? o.comment ?? "").trim().slice(0, 1e3), delivery, terms, payDays, nowIso(), o.id]
      ]
    ]);
    await log(o.id, c.get("user"), `\u0437\u043C\u0456\u043D\u0435\u043D\u043E ${isDraft ? "\u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0443" : "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F"}: ${items.length} \u043F\u043E\u0437., ${uah2(total)}`);
    if (isDraft) return c.json({ ok: true, total });
    const full = orderText("\u270F\uFE0F \u0417\u043C\u0456\u043D\u0435\u043D\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E", { id: o.id, entity: entityText(e), total, comment: b.comment ?? o.comment, delivery, pay_terms: terms, pay_days: payDays }, p, items);
    await tgAdmins(`${full}

${link(c, `b2borders/${o.id}`)}`);
    await hooks.finRequest?.(o.id, "changed").catch(() => 0);
    return c.json({ ok: true, total });
  });
  app.post("/api/b2b/p/orders/:id/send", async (c) => {
    const p = await myPartner(c);
    if (!isHead(c)) throw fail(403, "\u0412\u0456\u0434\u043F\u0440\u0430\u0432\u0438\u0442\u0438 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043A\u0435\u0440\u0456\u0432\u043D\u0438\u043A \u0432\u0430\u0448\u043E\u0457 \u043A\u043E\u043C\u0430\u043D\u0434\u0438.");
    return c.json(await sendDraft(c, p, await orderOf(c.req.param("id"), p.id)));
  });
  app.post("/api/b2b/orders/:id/send", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    return c.json(await sendDraft(c, p, o));
  });
  async function sendDraft(c, p, o) {
    if (o.kind !== "supply" || o.status !== "draft") throw fail(400, "\u0426\u0435 \u043D\u0435 \u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0430 \u2014 \u0457\u0457 \u0432\u0436\u0435 \u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E.");
    const items = await db.all(`SELECT product_id, name, article, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    if (!items.length) throw fail(400, "\u0427\u0435\u0440\u043D\u0435\u0442\u043A\u0430 \u043F\u043E\u0440\u043E\u0436\u043D\u044F \u2014 \u0434\u043E\u0434\u0430\u0439\u0442\u0435 \u0442\u043E\u0432\u0430\u0440\u0438.");
    const e = await myEntity(p, o.entity_id).catch(() => {
      throw fail(400, "\u042E\u0440\u043E\u0441\u043E\u0431\u0443 \u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0438 \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0456\u043D\u0448\u0443 (\xAB\u0417\u043C\u0456\u043D\u0438\u0442\u0438\xBB).");
    });
    await checkTerms(p, o.pay_terms === "postpay" ? "postpay" : "prepay", o.total, o.id);
    const claim = await db.run(`UPDATE b2b_orders SET status = 'invoice_wait', entity = ?, created_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`, [entityText(e), nowIso(), nowIso(), o.id]);
    if (!claim.changes) throw fail(409, "\u0427\u0435\u0440\u043D\u0435\u0442\u043A\u0443 \u0432\u0436\u0435 \u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E.");
    await log(o.id, c.get("user"), `\u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E: ${uah2(o.total)}`);
    const full = orderText("\u{1F195} \u041D\u043E\u0432\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F", { id: o.id, entity: entityText(e), total: o.total, comment: o.comment, delivery: o.delivery, pay_terms: o.pay_terms, pay_days: o.pay_days }, p, items);
    await tgAdmins(`${full}

${link(c, `b2borders/${o.id}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(o.id).catch(() => 0);
    return { ok: true, id: o.id, number: orderNo(o.id) };
  }
  app.post("/api/b2b/p/orders/:id/cancel", async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param("id"), p.id);
    if (o.kind !== "supply") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (o.status === "draft") {
      await hooks.toTrash(o, c.get("user"), { byPartner: true });
      return c.json({ ok: true, deleted: true });
    }
    if (o.status !== "invoice_wait") throw fail(400, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u0443\u0436\u0435 \u0432\u0438\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u2014 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440.");
    if (Number(o.paid_amount) > 0) throw fail(400, "\u0417\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0435\u044E \u0432\u0436\u0435 \u0454 \u043E\u043F\u043B\u0430\u0442\u0430 \u2014 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u0457\u0457 \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440.");
    if (await db.get(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' LIMIT 1`, [o.id])) {
      throw fail(400, "\u0417 \u0446\u0456\u0454\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0432\u0436\u0435 \u0454 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0441\u043A\u0430\u0441\u0443\u0439\u0442\u0435 \u0457\u0445.");
    }
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get("user"), "\u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F");
    await tgAdmins(`\u274C <b>\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)}</b> (\xAB${h3(p.name)}\xBB)
${link(c, `b2borders/${o.id}`)}`);
    await hooks.finClosed?.(o.id, "\u274C \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u043E\u043C").catch(() => 0);
    return c.json({ ok: true });
  });
  app.get("/api/b2b/orders", async (c) => {
    need(c, "b2b.admin");
    const f = listFilter(c);
    const where = [`o.kind = 'supply'`, ...f.where];
    const params = [...f.params];
    const st = c.req.query("status");
    const pid = parseInt(c.req.query("partner"), 10);
    if (st === "closed") where.push(CLOSED_SQL);
    else if (st && ORDER_STATUS[st]) {
      where.push("o.status = ?");
      params.push(st);
    }
    if (st !== "draft") where.push(`o.status != 'draft'`);
    if (pid) {
      where.push("o.partner_id = ?");
      params.push(pid);
    }
    const rows = await db.all(
      `SELECT o.*, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files, ${CLOSED_SQL} AS closed
       FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 300`,
      params
    );
    const [counts, closed] = await Promise.all([
      db.all(`SELECT status, COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' GROUP BY status`),
      // «Закрито» — лише серед закупівель за пів року (щоб лічильник не переглядав усю історію при кожному відкритті списку).
      db.get(`SELECT COUNT(*) AS n FROM b2b_orders o WHERE o.kind = 'supply' AND o.created_at > ? AND ${CLOSED_SQL}`, [new Date(Date.now() - 183 * 864e5).toISOString()])
    ]);
    return c.json({ rows: rows.map(publicOrder), statuses: LIST_STATUSES, counts: { ...Object.fromEntries(counts.map((r) => [r.status, r.n])), closed: closed?.n || 0 } });
  });
  app.get("/api/b2b/orders/:id", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    const p = await db.get(`SELECT id, name, phone, email FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    const missing = o.kind === "client" && o.status === "new" ? await hooks.missingDocs?.(o) || [] : [];
    return c.json({ ...await orderDetail(o), partner: p, missing });
  });
  app.put("/api/b2b/orders/:id", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    if (o.status === "cancelled") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    const b = await c.req.json();
    const status = await applyNumbers(o, b, c.get("user"), c);
    return c.json({ ok: true, status });
  });
  async function applyNumbers(o, b, user, c, how = "") {
    const next = {
      invoice_no: b.invoice_no !== void 0 ? String(b.invoice_no).trim().slice(0, 40) : o.invoice_no,
      invoice_date: b.invoice_date !== void 0 ? String(b.invoice_date).trim().slice(0, 10) : o.invoice_date,
      waybill_no: b.waybill_no !== void 0 ? String(b.waybill_no).trim().slice(0, 40) : o.waybill_no
    };
    if (next.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(next.invoice_date)) throw fail(400, "\u0414\u0430\u0442\u0430 \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u2014 \u0443 \u0444\u043E\u0440\u043C\u0430\u0442\u0456 \u0420\u0420\u0420\u0420-\u041C\u041C-\u0414\u0414.");
    let status = o.status;
    const paid = Number(o.paid_amount) || 0;
    if (o.kind === "supply" && next.invoice_no && status === "invoice_wait") status = paid > 0 && paid >= o.total - 4e-3 ? "paid" : paid > 0 ? "partial" : "pay_wait";
    if (o.kind === "supply" && !next.invoice_no && status === "pay_wait") status = "invoice_wait";
    const dueDate = o.pay_terms === "postpay" && next.invoice_no ? addDaysTo(next.invoice_date || today(), Number(o.pay_days) || 0) : o.due_date || "";
    const reinvoice = next.invoice_no && next.invoice_no !== o.invoice_no ? "" : o.reinvoice || "";
    await db.run(
      `UPDATE b2b_orders SET invoice_no = ?, invoice_date = ?, waybill_no = ?, status = ?, due_date = ?, reinvoice = ?, updated_at = ? WHERE id = ?`,
      [next.invoice_no, next.invoice_date, next.waybill_no, status, dueDate, reinvoice, nowIso(), o.id]
    );
    if (o.reinvoice && !reinvoice) await log(o.id, user, `\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043F\u0435\u0440\u0435\u0432\u0438\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E: \u2116 ${next.invoice_no} \u0437\u0430\u043C\u0456\u0441\u0442\u044C ${o.reinvoice}`);
    if (o.reinvoice && !reinvoice && status === "paid") await hooks.finPaid?.(o.id).catch(() => 0);
    if (dueDate && dueDate !== o.due_date) await log(o.id, user, `\u0441\u0442\u0440\u043E\u043A \u043E\u043F\u043B\u0430\u0442\u0438 (\u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0430): \u0434\u043E ${dueDate.split("-").reverse().join(".")}`);
    const changes = [];
    if (next.invoice_no !== o.invoice_no) changes.push(`\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${next.invoice_no || "\u2014"}${next.invoice_date ? ` \u0432\u0456\u0434 ${next.invoice_date}` : ""}`);
    if (next.waybill_no !== o.waybill_no) changes.push(`\u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 \u2116 ${next.waybill_no || "\u2014"}`);
    if (changes.length) await log(o.id, user, `${changes.join("; ")}${how}`);
    if (next.invoice_no !== o.invoice_no || next.waybill_no !== o.waybill_no) await hooks.finNumbers?.(o.id, how).catch(() => 0);
    if (next.invoice_no && next.invoice_no !== o.invoice_no) {
      await tgPartner(o.partner_id, `\u{1F9FE} <b>\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h3(next.invoice_no)}</b> \u043D\u0430 ${o.kind === "client" ? "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F" : "\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E"} ${orderNo(o.id)} \u2014 <b>${uah2(o.total)}</b>
\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443. \u0424\u0430\u0439\u043B \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u2014 \u0443 \u043A\u0430\u0431\u0456\u043D\u0435\u0442\u0456 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430.
${link(c, `${o.kind === "client" ? "pclients" : "porders"}/${o.id}`)}`);
    }
    return status;
  }
  app.post("/api/b2b/orders/:id/delivery", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    if (o.kind !== "supply" || o.status === "open") throw fail(400, "\u0421\u043F\u043E\u0441\u0456\u0431 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043D\u044F \u2014 \u043B\u0438\u0448\u0435 \u0434\u043B\u044F \u0437\u0432\u0438\u0447\u0430\u0439\u043D\u043E\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456.");
    const { delivery } = await c.req.json();
    if (!DELIVERY[delivery]) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0438\u0439 \u0441\u043F\u043E\u0441\u0456\u0431 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043D\u044F.");
    if (delivery === deliveryOf(o.delivery)) return c.json({ ok: true });
    if (delivery === "pickup" && await db.get(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' LIMIT 1`, [o.id])) {
      throw fail(400, "\u0417 \u0446\u0456\u0454\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0432\u0436\u0435 \u0454 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0441\u043A\u0430\u0441\u0443\u0439\u0442\u0435 \u0457\u0445, \u043F\u043E\u0442\u0456\u043C \u0441\u0442\u0430\u0432\u0442\u0435 \u0441\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437.");
    }
    await db.run(`UPDATE b2b_orders SET delivery = ?, updated_at = ? WHERE id = ?`, [delivery, nowIso(), o.id]);
    await log(o.id, c.get("user"), `\u0441\u043F\u043E\u0441\u0456\u0431 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043D\u044F: \xAB${DELIVERY[delivery]}\xBB (\u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440)`);
    await tgPartner(o.partner_id, `\u{1F501} \u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)}: \u0441\u043F\u043E\u0441\u0456\u0431 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043D\u044F \u0437\u043C\u0456\u043D\u0435\u043D\u043E \u043D\u0430 \xAB${DELIVERY[delivery]}\xBB.
${link(c, `porders/${o.id}`)}`);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/orders/:id/status", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    if (o.kind !== "supply") throw fail(400, "\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u0437\u043C\u0456\u043D\u044E\u0454\u0442\u044C\u0441\u044F \u043D\u0430 \u0439\u043E\u0433\u043E \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456.");
    const { status } = await c.req.json();
    if (!["paid", "done", "cancelled", "pay_wait"].includes(status)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0438\u0439 \u0441\u0442\u0430\u0442\u0443\u0441.");
    if (o.status === "open") throw fail(400, "\u0426\u0435 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F: \u0432\u043E\u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0430\u0454\u0442\u044C\u0441\u044F \u0456\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432. \u0421\u043F\u0435\u0440\u0448\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0444\u043E\u0440\u043C\u0443\u0454 \u043D\u0430 \u043D\u0435\u0457 \u0440\u0430\u0445\u0443\u043D\u043E\u043A.");
    if (status === "pay_wait" && !o.invoice_no) throw fail(400, "\u0421\u043F\u0435\u0440\u0448\u0443 \u0432\u043D\u0435\u0441\u0456\u0442\u044C \u043D\u043E\u043C\u0435\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443.");
    if (status === "paid" && !o.invoice_no) throw fail(400, "\u0421\u043F\u0435\u0440\u0448\u0443 \u0432\u043D\u0435\u0441\u0456\u0442\u044C \u043D\u043E\u043C\u0435\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443.");
    const u = c.get("user");
    const now = nowIso();
    if (status === "paid") {
      await db.run(`UPDATE b2b_orders SET status = 'paid', paid_amount = total, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?`, [now, userName2(u), now, o.id]);
      await log(o.id, u, "\u043F\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043E \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB \u0432\u0440\u0443\u0447\u043D\u0443");
      await tgPartner(o.partner_id, `\u2705 <b>\u041E\u043F\u043B\u0430\u0442\u0443 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E</b>: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)}${o.invoice_no ? `, \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h3(o.invoice_no)}` : ""} \u2014 ${uah2(o.total)}`);
      await hooks.finPaid?.(o.id).catch(() => 0);
      await hooks.crmPaid?.(o.id, new URL(c.req.url).origin).catch(() => 0);
    } else if (status === "pay_wait") {
      if (!["paid", "partial"].includes(o.status)) throw fail(400, "\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F \u0439 \u0442\u0430\u043A \u043E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443.");
      await hooks.payReset?.(o.id);
      await db.run(`UPDATE b2b_orders SET status = 'pay_wait', paid_amount = 0, paid_at = '', paid_by = '', updated_at = ? WHERE id = ?`, [now, o.id]);
      await log(o.id, u, o.status === "partial" ? "\u0437\u043D\u044F\u0442\u043E \u0447\u0430\u0441\u0442\u043A\u043E\u0432\u0443 \u043E\u043F\u043B\u0430\u0442\u0443 \u2014 \xAB\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443\xBB" : "\u0441\u0442\u0430\u0442\u0443\u0441: \xAB\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443\xBB (\u043E\u043F\u043B\u0430\u0442\u0443 \u0437\u043D\u044F\u0442\u043E)");
    } else {
      await db.run(`UPDATE b2b_orders SET status = ?, updated_at = ? WHERE id = ?`, [status, now, o.id]);
      await log(o.id, u, `\u0441\u0442\u0430\u0442\u0443\u0441: \xAB${ORDER_STATUS[status]}\xBB`);
      if (status === "cancelled") {
        await tgPartner(o.partner_id, `\u274C \u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)} \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u043E\u043C.`);
        await hooks.finClosed?.(o.id, "\u274C \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E").catch(() => 0);
      }
    }
    return c.json({ ok: true });
  });
  app.post("/api/b2b/orders/:id/files", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    const kind = FILE_KIND[c.req.query("kind")] ? c.req.query("kind") : "other";
    const f = await saveFile(c, o, kind);
    if (kind === "label") {
      const r = await hooks.afterLabel?.(o, f, c.get("user"));
      return c.json({ id: f.id, warnings: r?.warnings || [] });
    }
    const g = ["invoice", "waybill"].includes(kind) ? await groupOf(o.partner_id) : "";
    let toGroup = 0;
    if (g) {
      const caption = `${kind === "invoice" ? "\u{1F9FE} \u0420\u0430\u0445\u0443\u043D\u043E\u043A" : "\u{1F4E6} \u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430"}${kind === "invoice" && o.invoice_no ? ` \u2116 ${h3(o.invoice_no)}` : ""}${kind === "waybill" && o.waybill_no ? ` \u2116 ${h3(o.waybill_no)}` : ""} \u2014 ${o.kind === "client" ? "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F" : "\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F"} <b>${orderNo(o.id)}</b> \u043D\u0430 ${uah2(o.total)}`;
      toGroup = await services.notify?.sendFile?.({ chatIds: [g] }, f, caption).catch(() => 0) || 0;
      if (toGroup) await log(o.id, c.get("user"), `\u0444\u0430\u0439\u043B \xAB${f.name}\xBB \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u043D\u043E \u0432 Telegram-\u0433\u0440\u0443\u043F\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430`);
    }
    return c.json({ id: f.id, toGroup: !!toGroup });
  });
  async function saveFile(c, o, kind, bytes = null, extra = {}) {
    bytes = bytes || new Uint8Array(await c.req.arrayBuffer());
    let name = "file";
    try {
      name = decodeURIComponent(c.req.header("x-file-name") || "file");
    } catch {
    }
    return storeFile(o, kind, { bytes, name, mime: c.req.header("content-type"), ...extra }, c.get("user"));
  }
  async function labelInfo(bytes) {
    const hash2 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
    let np = null;
    if (bytes[0] === 37 && bytes[1] === 80) np = parseNpLabel(await pdfText(bytes).catch(() => ""));
    return { hash: hash2, ttn: np?.ttn || "", np };
  }
  async function labelDup({ hash: hash2, ttn }, exceptId = 0) {
    if (!hash2 && !ttn) return null;
    const row = await db.get(
      `SELECT o.id, o.client_name FROM b2b_orders o WHERE o.id IN (
         SELECT f.order_id FROM b2b_files f WHERE ? != '' AND f.hash = ? AND f.kind = 'label'
         UNION SELECT f.order_id FROM b2b_files f WHERE ? != '' AND f.ttn = ? AND f.kind = 'label'
         UNION SELECT x.id FROM b2b_orders x WHERE ? != '' AND x.ttn = ?)
       AND +o.kind = 'client' AND o.status != 'cancelled' AND o.id != ? ORDER BY o.id LIMIT 1`,
      [hash2 || "", hash2 || "", ttn || "", ttn || "", ttn || "", ttn || "", exceptId]
    );
    return row ? { id: row.id, number: orderNo(row.id), client_name: row.client_name } : null;
  }
  const dupText = (d) => `\u0422\u0430\u043A\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0454 \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 ${d.number} (${d.client_name}) \u2014 \u0442\u0435 \u0441\u0430\u043C\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0434\u0432\u0456\u0447\u0456 \u0434\u043E\u0434\u0430\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430.`;
  async function storeFile(o, kind, { bytes, name, mime, hash: hash2 = "", ttn = "" }, u, how = "") {
    if (!bytes?.length) throw fail(400, "\u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0444\u0430\u0439\u043B.");
    if (bytes.length > MAX_FILE) throw fail(400, "\u0424\u0430\u0439\u043B \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439 (\u0434\u043E 5 \u041C\u0411).");
    name = String(name || "file").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 150) || "file";
    mime = String(mime || "application/octet-stream").slice(0, 100);
    const parts = Math.ceil(bytes.length / PART);
    const r = await db.run(
      `INSERT INTO b2b_files (order_id, kind, name, mime, size, parts, created_by, created_at, hash, ttn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.id, kind, name, mime, bytes.length, parts, userName2(u), nowIso(), hash2, ttn]
    );
    const st = [];
    for (let n = 0; n < parts; n++) st.push([`INSERT INTO b2b_file_parts (file_id, n, data) VALUES (?, ?, ?)`, [r.lastId, n, toB64(bytes.subarray(n * PART, (n + 1) * PART))]]);
    await db.batch(st);
    await log(o.id, u, `\u0434\u043E\u0434\u0430\u043D\u043E \u0444\u0430\u0439\u043B: ${FILE_KIND[kind]} \xAB${name}\xBB${how}`);
    if (["invoice", "waybill"].includes(kind) && o.reinvoiced_at) {
      const old = await db.all(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = ? AND created_at < ? AND id != ?`, [o.id, kind, o.reinvoiced_at, r.lastId]);
      for (const f of old) await deleteFile(f.id);
      if (old.length) await log(o.id, u, `\u0441\u0442\u0430\u0440\u0438\u0439 \u0444\u0430\u0439\u043B (${FILE_KIND[kind].toLowerCase()}) \u0437\u0430\u043C\u0456\u043D\u0435\u043D\u043E \u043D\u043E\u0432\u0438\u043C`);
    }
    return { id: r.lastId, bytes, name, mime };
  }
  async function deleteFile(fileId) {
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [fileId]], [`DELETE FROM b2b_files WHERE id = ?`, [fileId]]]);
  }
  async function sendFile(f) {
    const parts = await db.all(`SELECT data FROM b2b_file_parts WHERE file_id = ? ORDER BY n`, [f.id]);
    if (parts.length !== f.parts) throw fail(410, "\u0424\u0430\u0439\u043B \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E (\u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F 30 \u0434\u043D\u0456\u0432).");
    const chunks = parts.map((p) => fromB64(p.data));
    const out = new Uint8Array(chunks.reduce((t, x) => t + x.length, 0));
    let off = 0;
    for (const ch of chunks) {
      out.set(ch, off);
      off += ch.length;
    }
    return new Response(out, {
      headers: {
        "Content-Type": f.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, max-age=300"
      }
    });
  }
  app.get("/api/b2b/files/:id", async (c) => {
    need(c, "b2b.admin");
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ?`, [c.req.param("id")]);
    if (!f) throw fail(404, "\u0424\u0430\u0439\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E (\u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F 30 \u0434\u043D\u0456\u0432).");
    return sendFile(f);
  });
  app.delete("/api/b2b/files/:id", async (c) => {
    need(c, "b2b.admin");
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ?`, [c.req.param("id")]);
    if (!f) throw fail(404, "\u0424\u0430\u0439\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [f.id]], [`DELETE FROM b2b_files WHERE id = ?`, [f.id]]]);
    await log(f.order_id, c.get("user"), `\u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u0444\u0430\u0439\u043B \xAB${f.name}\xBB`);
    return c.json({ ok: true });
  });
  app.get("/api/b2b/p/files/:id", async (c) => {
    const p = await myPartner(c);
    const f = await db.get(`SELECT f.* FROM b2b_files f JOIN b2b_orders o ON o.id = f.order_id WHERE f.id = ? AND o.partner_id = ?`, [c.req.param("id"), p.id]);
    if (!f) throw fail(404, "\u0424\u0430\u0439\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E (\u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F 30 \u0434\u043D\u0456\u0432).");
    return sendFile(f);
  });
  return { entityText, myEntity, orderText, deliveryOf, DELIVERY, debtOf, postpayInfo, overdueDays, labelInfo, labelDup, dupText, getOpen, rebuildOpen, unpaidTotal, limitsOf, applyNumbers, storeFile, deleteFile, groupOf, FILE_KIND, ORDER_STATUS, priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah: uah2, h: h3 };
}

// src/modules/b2b/clients.js
var CRM_REFRESH_MIN = 10;
var CRM_TRACK_DAYS = 60;
var SENDING_TTL_MS = 2 * 60 * 1e3;
var ID_RE = /^[1-9]\d{0,9}$/;
var CODE_RE = /^\d{11,20}$/;
var DEFAULT_OFFICE = "27";
var OPT_ID_RE = /^\d{0,10}$/;
var TTN_FIELDS = ["", "additional_2", "additional_3", "additional_4", "delivery_adress"];
var newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(1e4 + Math.random() * 9e4))}`;
function mountB2bClients(app, { db, fetchFn, myPartner, orders, hooks = {} }) {
  const { labelInfo, labelDup, dupText, getOpen, rebuildOpen, unpaidTotal, limitsOf: limitsOf2, priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah: uah3, h: h6 } = orders;
  const userName5 = (u) => u?.name || u?.login || "";
  const SELECT = `SELECT o.*, s.status AS supply_status, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files,
    (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id AND f.kind = 'label') AS labels
    FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id`;
  async function crmConfig() {
    const s = await loadSettings(db);
    const creds = { subdomain: s.lpcrm_subdomain || "", key: s.lpcrm_key || "" };
    return {
      on: s.b2b_crm_on === "1",
      office: s.b2b_crm_office ?? DEFAULT_OFFICE,
      // Типово: доставка «Нова пошта» (ID 1), оплачена закупівля — вид оплати «Оплачено» (ID 1), неоплачена — порожньо.
      delivery: s.b2b_crm_delivery ?? "1",
      payment: s.b2b_crm_payment || "",
      paymentPaid: s.b2b_crm_payment_paid ?? "1",
      notification: s.b2b_crm_notification || "",
      // ТТН іде в поле ТТН (ttn); адреса доставки — відділення з маркування, тож «адреса» як копія ТТН більше не потрібна.
      ttnField: TTN_FIELDS.includes(s.b2b_crm_ttn_field) && s.b2b_crm_ttn_field !== "delivery_adress" ? s.b2b_crm_ttn_field : "",
      site: s.b2b_crm_site || "",
      hasInKey: !!s.lpcrm_in_key,
      creds,
      addCreds: { subdomain: creds.subdomain, key: s.lpcrm_in_key || creds.key }
    };
  }
  app.get("/api/b2b/crm-settings", async (c) => {
    need(c, "b2b.admin");
    const k = await crmConfig();
    return c.json({
      on: k.on,
      office: k.office,
      delivery: k.delivery,
      payment: k.payment,
      payment_paid: k.paymentPaid,
      notification: k.notification,
      ttn_field: k.ttnField,
      site: k.site,
      in_key: k.hasInKey ? MASK : "",
      ready: !!(k.creds.subdomain && k.creds.key)
    });
  });
  app.put("/api/b2b/crm-settings", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json();
    const office = String(b.office ?? "").trim();
    if (office && !ID_RE.test(office)) throw fail(400, "ID \u0432\u0456\u0434\u0434\u0456\u043B\u0443 \u2014 \u0447\u0438\u0441\u043B\u043E \u0437 LP-CRM (\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u2192 \u0412\u0456\u0434\u0434\u0456\u043B\u0438).");
    if (b.on && !office) throw fail(400, "\u0421\u043F\u0435\u0440\u0448\u0443 \u0432\u043A\u0430\u0436\u0456\u0442\u044C ID \u0432\u0456\u0434\u0434\u0456\u043B\u0443 B2B.");
    const opt = {};
    for (const [f, name] of [["delivery", "\u0432\u0438\u0434\u0443 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438"], ["payment", "\u0432\u0438\u0434\u0443 \u043E\u043F\u043B\u0430\u0442\u0438"], ["payment_paid", "\u0432\u0438\u0434\u0443 \u043E\u043F\u043B\u0430\u0442\u0438 \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB"], ["notification", "\u043F\u043E\u0437\u043D\u0430\u0447\u043A\u0438"]]) {
      opt[f] = String(b[f] ?? "").trim();
      if (!OPT_ID_RE.test(opt[f])) throw fail(400, `ID ${name} \u2014 \u0447\u0438\u0441\u043B\u043E \u0437 LP-CRM \u0430\u0431\u043E \u043F\u043E\u0440\u043E\u0436\u043D\u044C\u043E.`);
    }
    const ttnField = TTN_FIELDS.includes(b.ttn_field) ? b.ttn_field : "";
    const set = (key, value) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]];
    const st = [
      set("b2b_crm_office", office),
      set("b2b_crm_on", b.on ? "1" : "0"),
      set("b2b_crm_delivery", opt.delivery),
      set("b2b_crm_payment", opt.payment),
      set("b2b_crm_notification", opt.notification),
      set("b2b_crm_ttn_field", ttnField)
    ];
    if (b.payment_paid !== void 0) st.push(set("b2b_crm_payment_paid", opt.payment_paid));
    if (b.site !== void 0) {
      const site = String(b.site).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
      if (site && !/^[a-z0-9.-]{3,100}$/.test(site)) throw fail(400, "\u0421\u0430\u0439\u0442 \u2014 \u0434\u043E\u043C\u0435\u043D \u0431\u0435\u0437 https://, \u043D\u0430\u043F\u0440. b2b.ecovent.ua");
      st.push(set("b2b_crm_site", site));
    }
    if (b.in_key !== void 0 && b.in_key !== MASK) {
      const key = String(b.in_key).trim();
      if (key && !/^[A-Za-z0-9]{16,64}$/.test(key)) throw fail(400, "\u0412\u0445\u0456\u0434\u043D\u0438\u0439 \u043A\u043B\u044E\u0447 API \u2014 \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438 \u0439 \u0446\u0438\u0444\u0440\u0438 (\u044F\u043A \u0443 LP-CRM \u2192 \u0406\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0456\u0457 \u2192 Landing page).");
      st.push(set("lpcrm_in_key", key));
    }
    await db.batch(st);
    return c.json({ ok: true });
  });
  async function statusNames(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache?.map && cache.sub === creds.subdomain && Date.now() - cache.at < 864e5) return cache.map;
    const map = await getStatuses(fetchFn, creds);
    await db.run(
      `INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify({ at: Date.now(), sub: creds.subdomain, map })]
    );
    return map;
  }
  async function codeOfId(id) {
    const r = await db.get(`SELECT code FROM an_orders WHERE id = ?`, [parseInt(id, 10) || 0]).catch(() => null) || await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [String(id)]).catch(() => null);
    return r?.code ? String(r.code) : "";
  }
  async function refreshCrm({ partnerId = null, ids = null } = {}) {
    const border = new Date(Date.now() - CRM_REFRESH_MIN * 6e4).toISOString();
    const since = new Date(Date.now() - CRM_TRACK_DAYS * 864e5).toISOString();
    const where = [`kind = 'client'`, `status = 'crm'`, `(crm_id != '' OR crm_ext != '')`];
    const params = [];
    if (ids) {
      where.push(`id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(ids));
    } else {
      where.push("crm_checked_at < ?", "created_at > ?");
      params.push(border, since);
    }
    if (partnerId) {
      where.push("partner_id = ?");
      params.push(partnerId);
    }
    const rows = await db.all(`SELECT id, crm_id, crm_ext FROM b2b_orders WHERE ${where.join(" AND ")} ORDER BY crm_checked_at LIMIT 100`, params);
    const linked = [];
    if (!rows.length) return;
    const { creds } = await crmConfig();
    if (!creds.subdomain || !creds.key) return;
    const now = nowIso();
    for (const r of rows) if (!r.crm_ext && r.crm_id) r.crm_ext = await codeOfId(r.crm_id);
    const known = rows.filter((r) => r.crm_ext);
    const unknown = rows.filter((r) => !r.crm_ext);
    const st = unknown.map((r) => [
      `UPDATE b2b_orders SET crm_status = ?, crm_checked_at = ? WHERE id = ?`,
      ["\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u2019\u044F\u0432\u0438\u0442\u044C\u0441\u044F \u043F\u0456\u0441\u043B\u044F \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0438", now, r.id]
    ]);
    try {
      if (known.length) {
        const found = await getOrdersBatch(fetchFn, creds, [...new Set(known.map((r) => r.crm_ext))]);
        const names = await statusNames(creds).catch(() => ({}));
        const byCode = new Map(found.map((o) => [String(o.order_id ?? ""), o]));
        for (const r of known) {
          const o = byCode.get(r.crm_ext);
          const s = o ? String(o.status ?? o.status_id ?? "") : "";
          const name = o ? String((names[s]?.name ?? names[s]) || s || "\u2014").trim() : "\u041D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0432 CRM";
          const num5 = o && /^\d+$/.test(String(o.id ?? "")) ? String(o.id) : r.crm_id;
          st.push([`UPDATE b2b_orders SET crm_status = ?, crm_checked_at = ?, crm_ext = ?, crm_id = ? WHERE id = ?`, [name, now, r.crm_ext, num5 || "", r.id]]);
          if (num5 && !r.crm_id) linked.push([r.id, num5]);
        }
      }
    } catch {
    }
    if (st.length) await db.batch(st);
    for (const [id, num5] of linked) await hooks.crmLinked?.(id, num5).catch(() => 0);
    if (linked.length) {
      const sup = await db.all(`SELECT DISTINCT supply_id FROM b2b_orders WHERE id IN (SELECT value FROM json_each(?)) AND supply_id IS NOT NULL`, [JSON.stringify(linked.map(([id]) => id))]);
      for (const r of sup) await supplyInWork(r.supply_id).catch(() => 0);
    }
  }
  function clientFields(b) {
    const name = String(b.client_name ?? "").trim().replace(/\s+/g, " ").slice(0, 150);
    let phone = String(b.client_phone ?? "").replace(/\D/g, "");
    if (/^0\d{9}$/.test(phone)) phone = `38${phone}`;
    const ttn = String(b.ttn ?? "").replace(/\s/g, "").toUpperCase().slice(0, 40);
    if (!name) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u041F\u0406\u0411 \u043A\u043B\u0456\u0454\u043D\u0442\u0430.");
    if (!/^380\d{9}$/.test(phone)) throw fail(400, "\u0422\u0435\u043B\u0435\u0444\u043E\u043D \u043A\u043B\u0456\u0454\u043D\u0442\u0430: 0XXXXXXXXX \u0430\u0431\u043E 380XXXXXXXXX.");
    if (ttn && !/^[0-9A-Z-]{6,40}$/.test(ttn)) throw fail(400, "\u0422\u0422\u041D \u2014 \u043B\u0438\u0448\u0435 \u0446\u0438\u0444\u0440\u0438 \u0439 \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438 (6\u201340 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432).");
    return { client_name: name, client_phone: phone, ttn, comment: String(b.comment ?? "").trim().slice(0, 500) };
  }
  async function supplyItems(p, supplyId, items, exceptId = 0) {
    const s = await db.get(`SELECT * FROM b2b_orders WHERE id = ? AND partner_id = ? AND kind = 'supply'`, [supplyId, p.id]);
    if (!s) throw fail(404, "\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (s.status === "cancelled") throw fail(400, `\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(s.id)} \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0456\u043D\u0448\u0443.`);
    if (s.status === "open") throw fail(400, "\u0414\u043B\u044F \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \xAB\u0411\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456\xBB.");
    if (s.status === "draft") throw fail(400, `\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)} \u0449\u0435 \u0447\u0435\u0440\u043D\u0435\u0442\u043A\u0430 \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u043A\u0435\u0440\u0456\u0432\u043D\u0438\u043A \u0457\u0457 \u0432\u0456\u0434\u043F\u0440\u0430\u0432\u043B\u044F\u0454.`);
    if (s.delivery === "pickup") throw fail(400, `\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)} \u2014 \u0441\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437: \u0457\u0457 \u0442\u043E\u0432\u0430\u0440\u0438 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0437\u0430\u0431\u0438\u0440\u0430\u0454 \u0441\u0430\u043C, \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u0437 \u043D\u0435\u0457 \u043D\u0435 \u043E\u0444\u043E\u0440\u043C\u043B\u044E\u044E\u0442\u044C\u0441\u044F.`);
    const left = new Map((await supplyLeft(s.id, exceptId)).map((r) => [r.product_id, r]));
    const want = /* @__PURE__ */ new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id || !Number.isInteger(qty) || qty <= 0) continue;
      want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw fail(400, "\u0414\u043E\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0442\u043E\u0432\u0430\u0440 \u0456\u0437 \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044E.");
    return [...want].map(([id, qty]) => {
      const r = left.get(id);
      if (!r) throw fail(400, `\u0422\u043E\u0432\u0430\u0440\u0443 ID ${id} \u043D\u0435\u043C\u0430\u0454 \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(s.id)}.`);
      if (qty > r.left) throw fail(400, `\xAB${r.name}\xBB: \u0443 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(s.id)} \u0437\u0430\u043B\u0438\u0448\u0438\u043B\u043E\u0441\u044C ${Math.max(0, r.left)} \u0448\u0442.`);
      return { product_id: id, name: r.name, article: r.article || "", qty, price: r.price, rrp: r.rrp };
    });
  }
  async function buildItems(p, b, exceptId = 0, own = { openId: null, total: 0 }, { skipLimits = false } = {}) {
    const supplyId = parseInt(b.supply_id, 10) || null;
    if (supplyId) {
      const items2 = await supplyItems(p, supplyId, b.items, exceptId);
      return { supplyId, items: items2, total: totalOf(items2) };
    }
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const lim = limitsOf2(p);
    const open = await getOpen(p.id);
    if (skipLimits) return { supplyId: null, toOpen: true, openId: open?.id || null, items, total };
    const inOpen = open && own.openId === open.id ? own.total : 0;
    const openAfter = (open?.total || 0) - inOpen + total;
    if (openAfter > lim.open + 4e-3) {
      throw fail(400, `\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F \u043F\u0435\u0440\u0435\u0432\u0438\u0449\u0438\u0442\u044C \u043B\u0456\u043C\u0456\u0442 ${uah3(lim.open)} (\u0437\u0430\u0440\u0430\u0437 ${uah3((open?.total || 0) - inOpen)}, \u0446\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${uah3(total)}). \u0421\u0444\u043E\u0440\u043C\u0443\u0439\u0442\u0435 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0443 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E (\u043E\u0431\u0435\u0440\u0456\u0442\u044C \u044E\u0440\u043E\u0441\u043E\u0431\u0443) \u2014 \u043F\u0456\u0441\u043B\u044F \u0446\u044C\u043E\u0433\u043E \u043C\u043E\u0436\u043D\u0430 \u043F\u0440\u043E\u0434\u043E\u0432\u0436\u0443\u0432\u0430\u0442\u0438.`);
    }
    const unpaid = await unpaidTotal(p.id) - inOpen;
    if (unpaid + total > lim.unpaid + 4e-3) {
      throw fail(400, `\u041B\u0456\u043C\u0456\u0442 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0438\u0445 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u0435\u043B\u044C \u2014 ${uah3(lim.unpaid)}: \u0437\u0430\u0440\u0430\u0437 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ${uah3(unpaid)}. \u0421\u043F\u0435\u0440\u0448\u0443 \u043E\u043F\u043B\u0430\u0442\u0456\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0430\u0431\u043E \u0437\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.`);
    }
    return { supplyId: null, toOpen: true, openId: open?.id || null, items, total };
  }
  async function missingDocs(o) {
    const [types, have] = await Promise.all([
      db.all(`SELECT id, name FROM b2b_doc_types WHERE partner_id = ? AND active = 1 AND required = 1 ORDER BY sort, id`, [o.partner_id]),
      db.all(`SELECT kind, doc_type FROM b2b_files WHERE order_id = ?`, [o.id])
    ]);
    const out = [];
    if (!have.some((f) => f.kind === "label")) out.push("\u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F");
    for (const t of types) if (!have.some((f) => f.kind === "doc" && f.doc_type === t.id)) out.push(t.name);
    return out;
  }
  hooks.missingDocs = missingDocs;
  const ttnDupMsg = async (ttn, dup, partnerId) => (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === partnerId ? `\u0422\u0422\u041D ${ttn} \u0443\u0436\u0435 \u0454 \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 ${dup.number} (${dup.client_name}).` : `\u0422\u0422\u041D ${ttn} \u0443\u0436\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u043D\u0430 \u0432 \u0456\u043D\u0448\u043E\u043C\u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456.`;
  async function ensureOpen(p) {
    const open = await getOpen(p.id);
    if (open) return open.id;
    const now = nowIso();
    const r = await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, entity, total, created_by, created_at, updated_at) VALUES (?, 'supply', 'open', '', 0, '\u0430\u0432\u0442\u043E', ?, ?)`, [p.id, now, now]);
    await db.run(`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, '\u0430\u0432\u0442\u043E', '\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0456\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456')`, [r.lastId, now]);
    return r.lastId;
  }
  const supplyOf = (id) => id ? db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [id]) : null;
  async function warnUnpaidShipped(c, o) {
    const s = o.supply_id ? await db.get(`SELECT id, status, pay_terms, due_date FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
    const st = s?.status || "";
    if (["paid", "done"].includes(st) || !o.supply_id && o.paid_at) return;
    if (s?.pay_terms === "postpay" && !overdueDays(s)) return;
    const p = await db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    await tgAdmins(`\u26A0\uFE0F <b>\u0412\u0456\u0434\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F \u0431\u0435\u0437 \u043E\u043F\u043B\u0430\u0442\u0438</b>: ${orderNo(o.id)} (${h6(o.client_name)}, ${uah3(o.total)}) \xAB${h6(p?.name || "")}\xBB \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0432 CRM, \u0430 ${!o.supply_id ? "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u043D\u0435 \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0435" : st === "open" ? `\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.supply_id)} \u0449\u0435 \u0431\u0435\u0437 \u0440\u0430\u0445\u0443\u043D\u043A\u0443` : `\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.supply_id)} \u043D\u0435 \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0430 (${ORDER_STATUS[st] || st})`}.
${link(c, `b2bclients/${o.id}`)}`);
  }
  function senderOf(c, siteSetting) {
    const url = new URL(c.req.url);
    const host = siteSetting || url.host;
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
    return phpUrlencode(phpSerialize({
      HTTP_HOST: host,
      SERVER_NAME: host,
      REQUEST_URI: "/b2b",
      HTTP_REFERER: `https://${host}/b2b`,
      REMOTE_ADDR: ip,
      HTTP_USER_AGENT: "Ecovent B2B",
      REQUEST_SCHEME: "https",
      HTTPS: "on"
    }));
  }
  const dt = (iso) => iso ? new Date(iso).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const ukDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d.split("-").reverse().join(".") : "";
  const num4 = (n) => new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\s/g, " ");
  async function payText(o, partnerName) {
    if (!o.supply_id) return { paid: !!o.paid_at, text: o.paid_at ? `\u2705 \u041E\u041F\u041B\u0410\u0427\u0415\u041D\u041E (\u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456, \u043F\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043E ${dt(o.paid_at)})` : "\u23F3 \u0411\u0415\u0417 \u0417\u0410\u041A\u0423\u041F\u0406\u0412\u041B\u0406 \u2014 \u041E\u0427\u0406\u041A\u0423\u0404\u041C\u041E \u041E\u041F\u041B\u0410\u0422\u0423" };
    const s = await db.get(`SELECT * FROM b2b_orders WHERE id = ?`, [o.supply_id]);
    if (!s) return { paid: false, text: "" };
    if (s.status === "open") return { paid: false, text: `\u23F3 \u0411\u0415\u0417 \u0417\u0410\u041A\u0423\u041F\u0406\u0412\u041B\u0406 (\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}, \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0449\u0435 \u043D\u0435 \u0441\u0444\u043E\u0440\u043C\u043E\u0432\u0430\u043D\u043E) \u2014 \u041E\u0427\u0406\u041A\u0423\u0404\u041C\u041E \u041E\u041F\u041B\u0410\u0422\u0423` };
    const ent = String(s.entity || "").split("\n")[0];
    const inv = s.invoice_no ? `\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${s.invoice_no}${s.invoice_date ? ` \u0432\u0456\u0434 ${ukDate(s.invoice_date)}` : ""} \u043D\u0430 ${num4(s.total)} \u0433\u0440\u043D` : `\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0449\u0435 \u043D\u0435 \u0432\u0438\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E (${num4(s.total)} \u0433\u0440\u043D)`;
    const pays = await db.all(`SELECT amount, date, payer_name, payer_code, account FROM b2b_payments WHERE order_id = ? ORDER BY date`, [s.id]).catch(() => []);
    const lines = pays.map((t) => `\u041E\u043F\u043B\u0430\u0442\u0430 ${dt(t.date)} \u2014 ${num4(t.amount)} \u0433\u0440\u043D \u0432\u0456\u0434 ${t.payer_name || "\u2014"}${t.payer_code ? ` (${t.payer_code})` : ""}${t.account ? ` \u043D\u0430 ${t.account}` : ""}`);
    if (["paid", "done"].includes(s.status)) {
      return { paid: true, text: [
        `\u2705 \u041E\u041F\u041B\u0410\u0427\u0415\u041D\u041E: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}, ${inv}, \u043F\u043B\u0430\u0442\u043D\u0438\u043A ${ent}`,
        ...lines.length ? lines : [`\u041F\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043E \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB \u0432\u0440\u0443\u0447\u043D\u0443${s.paid_by && s.paid_by !== "Opendatabot" ? ` (${s.paid_by})` : ""}${s.paid_at ? ` ${dt(s.paid_at)}` : ""}`]
      ].join("\n") };
    }
    if (s.status === "partial") {
      return { paid: false, text: [`\u23F3 \u0427\u0410\u0421\u0422\u041A\u041E\u0412\u041E \u041E\u041F\u041B\u0410\u0427\u0415\u041D\u041E: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}, ${inv} \u2014 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E ${num4(s.paid_amount)}, \u0437\u0430\u043B\u0438\u0448\u043E\u043A ${num4(s.total - s.paid_amount)} \u0433\u0440\u043D`, ...lines].join("\n") };
    }
    if (s.pay_terms === "postpay") {
      return { paid: false, text: `\u23F3 \u0412\u0406\u0414\u0421\u0422\u0420\u041E\u0427\u041A\u0410 \u041E\u041F\u041B\u0410\u0422\u0418${s.due_date ? ` \u0434\u043E ${ukDate(s.due_date)}` : ` ${s.pay_days} \u0434\u043D. \u0432\u0456\u0434 \u0440\u0430\u0445\u0443\u043D\u043A\u0443`}: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}, ${inv}; \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 ${ent}, \u0432\u0456\u0434 \xAB${partnerName}\xBB${overdueDays(s) ? ` \u2014 \u041F\u0420\u041E\u0421\u0422\u0420\u041E\u0427\u0415\u041D\u041E ${overdueDays(s)} \u0434\u043D.` : ""}` };
    }
    return { paid: false, text: `\u23F3 \u041E\u0427\u0406\u041A\u0423\u0404\u041C\u041E \u041E\u041F\u041B\u0410\u0422\u0423: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}, ${inv}; \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 ${ent}, \u0432\u0456\u0434 \xAB${partnerName}\xBB` };
  }
  async function crmComment(o, partnerName) {
    const pay = await payText(o, partnerName);
    const comment = [`${orderNo(o.id)} \xB7 B2B \xAB${partnerName}\xBB`, o.ttn ? `\u0422\u0422\u041D \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430: ${o.ttn}` : "", pay.text, o.comment || ""].filter(Boolean).join("\n");
    return { paid: pay.paid, comment };
  }
  hooks.crmPaid = async (supplyId, base = "") => {
    const rows = await db.all(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
      WHERE o.supply_id = ? AND o.kind = 'client' AND o.status = 'crm'`, [supplyId]);
    for (const o of rows) {
      const { comment } = await crmComment(o, o.partner);
      await tgAdmins(`\u{1F4B0} <b>\u041E\u043F\u043B\u0430\u0442\u0443 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E</b>, \u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u0432 LP-CRM: <b>${orderNo(o.id)}</b>${o.crm_id ? ` \xB7 CRM \u2116 <b>${h6(o.crm_id)}</b>` : ""} (${h6(o.client_name)})
\u041F\u043E\u0441\u0442\u0430\u0432\u0442\u0435 \u0432 CRM \u0432\u0438\u0434 \u043E\u043F\u043B\u0430\u0442\u0438 \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB \u0456 \u0437\u0430\u043C\u0456\u043D\u0456\u0442\u044C \u043A\u043E\u043C\u0435\u043D\u0442\u0430\u0440 \u043D\u0430:
<pre>${h6(comment)}</pre>${base ? `
${link(base, `b2bclients/${o.id}`)}` : ""}`);
    }
  };
  const tgNew = async (c, p, id, f, it, verb = "\u041D\u043E\u0432\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430") => {
    const lines = it.items.slice(0, 60).map((i) => `${h6(i.name)} \u2014 ${i.qty} \u0448\u0442 \u2014 ${uah3(i.price)}`).join("\n");
    const text = `\u{1F4E6} <b>${verb} ${orderNo(id)}</b> \u0432\u0456\u0434 \xAB${h6(p.name)}\xBB

<b>\u041A\u043B\u0456\u0454\u043D\u0442:</b> ${h6(f.client_name)}, ${h6(f.client_phone)}${f.ttn ? `
<b>\u0422\u0422\u041D:</b> ${h6(f.ttn)}` : ""}
${it.supplyId ? `\u0406\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(it.supplyId)}` : `\u{1F534} <b>\u0411\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456</b> \u2014 \u0443 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0443 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(it.openId)}`}

<b>\u0422\u043E\u0432\u0430\u0440\u0438:</b>
${lines}

<b>\u0420\u0430\u0437\u043E\u043C: ${uah3(it.total)}</b>`;
    await tgAdmins(`${text}

${link(c, `b2bclients/${id}`)}`);
  };
  async function supplyInWork(supplyId, base = "") {
    if (!supplyId) return;
    const s = await db.get(`SELECT o.id, o.partner_id, o.status, o.group_done, ${CLOSED_SQL} AS closed FROM b2b_orders o WHERE o.id = ?`, [supplyId]);
    if (!s || !s.closed || s.group_done || s.status === "open") return;
    const rows = await db.all(`SELECT id, client_name, status, crm_id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' ORDER BY id`, [s.id]);
    if (!rows.length || rows.some((r) => r.status !== "crm" || !r.crm_id)) return;
    const claim = await db.run(`UPDATE b2b_orders SET group_done = 1 WHERE id = ? AND COALESCE(group_done, 0) = 0`, [s.id]);
    if (!claim.changes) return;
    const items = await db.all(`SELECT order_id, name, qty FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id`, [JSON.stringify(rows.map((r) => r.id))]);
    const lines = rows.map((r) => `\u2022 CRM \u2116 <b>${h6(r.crm_id)}</b> \xB7 ${h6(r.client_name)} \u2014 ${items.filter((i) => i.order_id === r.id).map((i) => `${h6(i.name)} \xD7 ${i.qty}`).join(", ")}`);
    await tgGroup(s.partner_id, `\u2705 <b>\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(s.id)}: \u0443\u0441\u0456 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0437\u044F\u0442\u043E \u0432 \u0440\u043E\u0431\u043E\u0442\u0443 \u0441\u043A\u043B\u0430\u0434\u043E\u043C</b>

${lines.slice(0, 60).join("\n")}${lines.length > 60 ? `
\u2026\u0456 \u0449\u0435 ${lines.length - 60}` : ""}${base ? `

${link(base, `porders/${s.id}`)}` : ""}`);
  }
  hooks.supplyInWork = supplyInWork;
  app.get("/api/b2b/p/supplies", async (c) => {
    const p = await myPartner(c);
    const since = new Date(Date.now() - 180 * 864e5).toISOString();
    const rows = await db.all(
      `SELECT s.id, s.status, s.created_at, s.total, s.invoice_no, i.product_id, i.name, i.article, i.price, i.qty,
         COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
           WHERE co.supply_id = s.id AND co.kind = 'client' AND co.status != 'cancelled' AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_orders s JOIN b2b_order_items i ON i.order_id = s.id
       WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status NOT IN ('cancelled', 'open', 'draft') AND COALESCE(s.delivery, 'np') != 'pickup' AND s.created_at > ? ORDER BY s.id DESC, i.id`,
      [p.id, since]
    );
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, number: orderNo(r.id), status: r.status, status_name: ORDER_STATUS[r.status] || r.status, created_at: r.created_at, total: r.total, invoice_no: r.invoice_no, pay: payState({ kind: "client", supply_id: r.id, supply_status: r.status }), items: [] });
      map.get(r.id).items.push({ product_id: r.product_id, name: r.name, article: r.article, price: r.price, qty: r.qty, left: r.qty - r.used });
    }
    return c.json([...map.values()].filter((s) => s.items.some((i) => i.left > 0)));
  });
  app.get("/api/b2b/p/clients", async (c) => {
    const p = await myPartner(c);
    await refreshCrm({ partnerId: p.id });
    const f = listFilter(c, { client: true });
    const st = c.req.query("status");
    if (st && CLIENT_STATUS[st]) {
      f.where.push("o.status = ?");
      f.params.push(st);
    }
    const rows = await db.all(`${SELECT} WHERE o.partner_id = ? AND o.kind = 'client' ${f.where.map((w) => `AND ${w}`).join(" ")} ORDER BY o.id DESC LIMIT 300`, [p.id, ...f.params]);
    return c.json({ rows: rows.map(publicOrder), statuses: CLIENT_STATUS });
  });
  async function myClientOrder(c, p) {
    const o = await orderOf(c.req.param("id"), p.id);
    if (o.kind !== "client") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return o;
  }
  app.get("/api/b2b/p/clients/:id", async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.crm_id) await refreshCrm({ partnerId: p.id });
    return c.json({ ...await orderDetail(await orderOf(o.id, p.id)), missing: await missingDocs(o) });
  });
  const docTypes = (partnerId) => db.all(`SELECT id, name, required, print FROM b2b_doc_types WHERE partner_id = ? AND active = 1 ORDER BY sort, id`, [partnerId]);
  app.get("/api/b2b/p/doc-types", async (c) => c.json(await docTypes((await myPartner(c)).id)));
  app.put("/api/b2b/p/doc-types", async (c) => {
    const p = await myPartner(c);
    need(c, "b2b.team");
    const list = (await c.req.json()).types;
    if (!Array.isArray(list)) throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0456 \u0434\u0430\u043D\u0456.");
    const rows = list.map((t) => ({ id: parseInt(t.id, 10) || 0, name: String(t.name || "").trim().replace(/\s+/g, " ").slice(0, 60), required: t.required ? 1 : 0, print: t.print === false ? 0 : 1 })).filter((t) => t.name);
    if (rows.length > 5) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 5 \u0432\u0438\u0434\u0456\u0432 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456\u0432.");
    if (new Set(rows.map((t) => t.name.toLowerCase())).size !== rows.length) throw fail(400, "\u041D\u0430\u0437\u0432\u0438 \u0432\u0438\u0434\u0456\u0432 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456\u0432 \u043C\u0430\u044E\u0442\u044C \u0432\u0456\u0434\u0440\u0456\u0437\u043D\u044F\u0442\u0438\u0441\u044F.");
    if (rows.some((t) => /^маркуван/i.test(t.name))) throw fail(400, "\u041C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0454 \u0437\u0430\u0432\u0436\u0434\u0438 \u2014 \u0434\u043E\u0434\u0430\u0439\u0442\u0435 \u0456\u043D\u0448\u0456 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0438.");
    const cur = await db.all(`SELECT id FROM b2b_doc_types WHERE partner_id = ? AND active = 1`, [p.id]);
    const keep = new Set(rows.filter((t) => t.id && cur.some((x) => x.id === t.id)).map((t) => t.id));
    const st = cur.filter((x) => !keep.has(x.id)).map((x) => [`UPDATE b2b_doc_types SET active = 0 WHERE id = ?`, [x.id]]);
    rows.forEach((t, i) => st.push(keep.has(t.id) ? [`UPDATE b2b_doc_types SET name = ?, required = ?, print = ?, sort = ? WHERE id = ? AND partner_id = ?`, [t.name, t.required, t.print, i, t.id, p.id]] : [`INSERT INTO b2b_doc_types (partner_id, name, required, print, sort, active) VALUES (?, ?, ?, ?, ?, 1)`, [p.id, t.name, t.required, t.print, i]]));
    if (st.length) await db.batch(st);
    return c.json({ ok: true, types: await docTypes(p.id) });
  });
  app.post("/api/b2b/p/clients", async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const f = clientFields(b);
    if (f.ttn) {
      const dup = await labelDup({ ttn: f.ttn });
      if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id));
    }
    const it = await buildItems(p, b);
    if (it.toOpen) {
      it.openId = await ensureOpen(p);
      it.supplyRef = it.openId;
    }
    const now = nowIso();
    const u = c.get("user");
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, supply_id, client_name, client_phone, ttn, total, comment, created_by, created_at, updated_at)
       VALUES (?, 'client', 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, userName5(u), now, now]
    );
    await db.batch([...itemRows(r.lastId, it.items), [
      `INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
      [r.lastId, now, userName5(u), `\u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u043D\u0430 ${uah3(it.total)}${it.supplyId ? ` \u0456\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(it.supplyId)}` : ` \u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 (\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(it.openId)})`}`]
    ]]);
    if (it.openId) await rebuildOpen(it.openId);
    await tgNew(c, p, r.lastId, f, it);
    return c.json({ id: r.lastId, number: orderNo(r.lastId), total: it.total });
  });
  app.put("/api/b2b/p/clients/:id", async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== "new") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u0435 \u0432 \u0440\u043E\u0431\u043E\u0442\u0443 \u2014 \u0437\u043C\u0456\u043D\u0438\u0442\u0438 \u0439\u043E\u0433\u043E \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440.");
    if (o.pending) throw fail(400, "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0437\u043C\u0456\u043D\u0438\u0432 \u0446\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0456\u0442\u044C \u0430\u0431\u043E \u0432\u0456\u0434\u0445\u0438\u043B\u0456\u0442\u044C \u0437\u043C\u0456\u043D\u0438.");
    const b = await c.req.json();
    const f = clientFields(b);
    if (f.ttn) {
      const dup = await labelDup({ ttn: f.ttn }, o.id);
      if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id));
    }
    const cur = await supplyOf(o.supply_id);
    const it = await buildItems(p, b, o.id, { openId: cur?.status === "open" ? cur.id : null, total: o.total });
    if (it.toOpen) it.openId = await ensureOpen(p);
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, it.items),
      [
        `UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, nowIso(), o.id]
      ]
    ]);
    if (it.openId) await rebuildOpen(it.openId);
    if (cur?.status === "open" && cur.id !== it.openId) await rebuildOpen(cur.id);
    await log(o.id, c.get("user"), `\u0437\u043C\u0456\u043D\u0435\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430: ${it.items.length} \u043F\u043E\u0437., ${uah3(it.total)}`);
    await tgNew(c, p, o.id, f, it, "\u0417\u043C\u0456\u043D\u0435\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430");
    return c.json({ ok: true, total: it.total });
  });
  app.get("/api/b2b/clients/:id/edit-options", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    if (o.kind !== "client") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const since = new Date(Date.now() - 365 * 864e5).toISOString();
    const rows = await db.all(
      `SELECT s.id, s.status, i.product_id, i.name, i.article, i.price, i.qty,
         COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
           WHERE co.supply_id = s.id AND co.kind = 'client' AND co.status != 'cancelled' AND co.id != ? AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_orders s JOIN b2b_order_items i ON i.order_id = s.id
       WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status NOT IN ('cancelled', 'open', 'draft') AND COALESCE(s.delivery, 'np') != 'pickup'
         AND (s.created_at > ? OR s.id = ?) ORDER BY s.id DESC, i.id`,
      [o.id, o.partner_id, since, o.supply_id || 0]
    );
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, number: orderNo(r.id), status_name: ORDER_STATUS[r.status] || r.status, items: [] });
      map.get(r.id).items.push({ product_id: r.product_id, name: r.name, article: r.article, price: r.price, left: r.qty - r.used });
    }
    const supplies = [...map.values()].filter((s) => s.id === o.supply_id || s.items.some((i) => i.left > 0));
    return c.json({ supplies, catalog: await hooks.partnerCatalog(o.partner_id) });
  });
  const snapOf = async (o) => ({
    supply_id: o.supply_id,
    client_name: o.client_name,
    client_phone: o.client_phone,
    ttn: o.ttn || "",
    comment: o.comment || "",
    total: o.total,
    status: o.status,
    crm_id: o.crm_id || "",
    crm_ext: o.crm_ext || "",
    crm_status: o.crm_status || "",
    crm_sent_at: o.crm_sent_at || "",
    items: await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id])
  });
  function diffOf(a, b) {
    const ch = [];
    if (a.client_name !== b.client_name) ch.push(`\u041F\u0406\u0411: ${a.client_name} \u2192 ${b.client_name}`);
    if (a.client_phone !== b.client_phone) ch.push(`\u0442\u0435\u043B\u0435\u0444\u043E\u043D: ${a.client_phone} \u2192 ${b.client_phone}`);
    if ((a.ttn || "") !== (b.ttn || "")) ch.push(`\u0422\u0422\u041D: ${a.ttn || "\u2014"} \u2192 ${b.ttn || "\u2014"}`);
    if ((a.comment || "") !== (b.comment || "")) ch.push(`\u043A\u043E\u043C\u0435\u043D\u0442\u0430\u0440: ${b.comment || "\u2014"}`);
    if (a.supply_id !== b.supply_id) ch.push(`\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F: ${a.supply_id ? orderNo(a.supply_id) : "\u2014"} \u2192 ${b.supply_id ? orderNo(b.supply_id) : "\u2014"}`);
    const am = new Map(a.items.map((i) => [i.product_id, i]));
    for (const i of b.items) {
      const x = am.get(i.product_id);
      if (!x) ch.push(`+ ${i.name} \xD7 ${i.qty}`);
      else if (x.qty !== i.qty) ch.push(`${i.name}: ${x.qty} \u2192 ${i.qty} \u0448\u0442`);
    }
    for (const x of a.items) if (!b.items.some((i) => i.product_id === x.product_id)) ch.push(`\u2212 ${x.name} \xD7 ${x.qty}`);
    return ch;
  }
  const brief = (x) => `${x.client_name}, ${phoneTxt(x.client_phone)}${x.ttn ? `, \u0422\u0422\u041D ${x.ttn}` : ""}
${x.items.map((i) => `   ${i.name} \xD7 ${i.qty} \u2014 ${uah3(i.price)}`).join("\n")}
   ${x.supply_id ? `\u0456\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(x.supply_id)}` : "\u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456"} \xB7 \u0440\u0430\u0437\u043E\u043C ${uah3(x.total)}`;
  const phoneTxt = (ph) => String(ph).length === 12 ? `+${ph}` : ph;
  app.put("/api/b2b/clients/:id/edit", async (c) => {
    need(c, "b2b.admin");
    let o = await orderOf(c.req.param("id"));
    if (o.kind !== "client") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (o.status === "cancelled") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    const b = await c.req.json();
    const f = clientFields(b);
    if (f.ttn) {
      const dup = await labelDup({ ttn: f.ttn }, o.id);
      if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id));
    }
    const supplyId = parseInt(b.supply_id, 10) || null;
    let supplyNote = null;
    if (supplyId) {
      const left = new Map((await supplyLeft(supplyId, o.id)).map((r) => [r.product_id, r.left]));
      const add = /* @__PURE__ */ new Map();
      for (const it2 of Array.isArray(b.items) ? b.items : []) {
        const id = parseInt(it2.product_id, 10);
        const n = Math.floor(Number(it2.qty)) || 0;
        if (id && n > 0) add.set(id, (add.get(id) || 0) + n);
      }
      for (const [id, n] of [...add]) {
        const need2 = n - Math.max(0, left.get(id) ?? 0);
        if (need2 > 0) add.set(id, need2);
        else add.delete(id);
      }
      if (add.size) {
        if (!b.add_to_supply) throw fail(400, `\u0426\u0438\u0445 \u0442\u043E\u0432\u0430\u0440\u0456\u0432 \u043D\u0435\u043C\u0430\u0454 \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(supplyId)} (\u0430\u0431\u043E \u0431\u0440\u0430\u043A\u0443\u0454 \u0437\u0430\u043B\u0438\u0448\u043A\u0443) \u2014 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0456\u0442\u044C \u0434\u043E\u0434\u0430\u0432\u0430\u043D\u043D\u044F \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E.`);
        supplyNote = await hooks.supplyAdd(c, supplyId, add);
      }
    }
    const before = o.pending ? JSON.parse(o.pending).before : await snapOf(o);
    const cur = await supplyOf(o.supply_id);
    const it = await buildItems(p, b, o.id, { openId: cur?.status === "open" ? cur.id : null, total: o.total }, { skipLimits: true });
    if (it.toOpen) it.openId = await ensureOpen(p);
    const wasCrm = o.status === "crm";
    const oldCrm = o.crm_id || o.crm_ext || "";
    const now = nowIso();
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, it.items),
      [
        `UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, now, o.id]
      ],
      // Було в CRM — старе замовлення анульоване: знову «Нове», після підтвердження партнером передається в CRM як нове.
      ...wasCrm ? [[`UPDATE b2b_orders SET status = 'new', crm_id = '', crm_ext = '', crm_status = '', crm_sent_at = '', crm_old = ? WHERE id = ?`, [oldCrm, o.id]]] : []
    ]);
    if (it.openId) await rebuildOpen(it.openId);
    if (cur?.status === "open" && cur.id !== it.openId) await rebuildOpen(cur.id);
    o = await orderOf(o.id);
    const after = await snapOf(o);
    const changes = diffOf(before, after);
    const crmOld = wasCrm ? oldCrm : o.pending ? JSON.parse(o.pending).crm_old || "" : "";
    const by = userName5(c.get("user"));
    await db.run(
      `UPDATE b2b_orders SET pending = ? WHERE id = ?`,
      [changes.length || crmOld ? JSON.stringify({ before, changes, by, at: now, crm_old: crmOld }) : "", o.id]
    );
    await log(o.id, c.get("user"), `\u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440: ${changes.join("; ") || "\u0431\u0435\u0437 \u0437\u043C\u0456\u043D"} \u2014 ${uah3(it.total)}${wasCrm ? ` \xB7 \u0441\u0442\u0430\u0440\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432 CRM \u2116 ${oldCrm} \u0430\u043D\u0443\u043B\u044C\u043E\u0432\u0430\u043D\u043E` : ""}${changes.length ? " \xB7 \u0447\u0435\u043A\u0430\u0454 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430" : ""}`.slice(0, 1800));
    if (changes.length || wasCrm) {
      const url = link(c, `pclients/${o.id}`);
      if (wasCrm) {
        const text = `\u267B\uFE0F <b>\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} \u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440</b>

\u274C \u0421\u0442\u0430\u0440\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432 LP-CRM \u2116 <b>${h6(oldCrm)}</b> \u0430\u043D\u0443\u043B\u044C\u043E\u0432\u0430\u043D\u043E (\u0443\u0442\u0438\u043B\u0456\u0437\u043E\u0432\u0430\u043D\u043E):
<pre>${h6(brief(before))}</pre>
\u2705 \u0411\u0443\u0434\u0435 \u0441\u0442\u0432\u043E\u0440\u0435\u043D\u0435 \u043D\u043E\u0432\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0437 \u043D\u043E\u0432\u043E\u044E \u0456\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0456\u0454\u044E:
<pre>${h6(brief(after))}</pre>
\u041F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0456\u0442\u044C \u0437\u043C\u0456\u043D\u0438 \u0432 \u043A\u0430\u0431\u0456\u043D\u0435\u0442\u0456 \u2014 \u043F\u0456\u0441\u043B\u044F \u0446\u044C\u043E\u0433\u043E \u043D\u043E\u0432\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043F\u0456\u0434\u0435 \u0432 \u0440\u043E\u0431\u043E\u0442\u0443.`;
        await tgPartner(o.partner_id, `${text}
${url}`);
        await tgGroup(o.partner_id, text);
        await tgAdmins(`\u267B\uFE0F ${orderNo(o.id)} \u0437\u043C\u0456\u043D\u0435\u043D\u043E: <b>\u0441\u043A\u0430\u0441\u0443\u0439\u0442\u0435 \u0432 LP-CRM \u0441\u0442\u0430\u0440\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u2116 ${h6(oldCrm)}</b>. \u041F\u0456\u0441\u043B\u044F \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u043E\u043C \u043F\u0435\u0440\u0435\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0435 (\xAB\u0414\u043E\u0434\u0430\u0442\u0438 \u0432 CRM\xBB).
${link(c, `b2bclients/${o.id}`)}`);
      } else {
        await tgPartner(o.partner_id, `\u270F\uFE0F <b>\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${orderNo(o.id)} \u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440</b> (${h6(f.client_name)})
${changes.slice(0, 15).map(h6).join("\n")}

\u041F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0456\u0442\u044C \u0430\u0431\u043E \u0432\u0456\u0434\u0445\u0438\u043B\u0456\u0442\u044C \u0437\u043C\u0456\u043D\u0438 \u0432 \u043A\u0430\u0431\u0456\u043D\u0435\u0442\u0456.
${url}`);
      }
    }
    return c.json({ ok: true, total: it.total, pending: changes.length > 0, crmOld: wasCrm ? oldCrm : "", supply: supplyNote });
  });
  async function pendingOrder(c) {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (!o.pending) throw fail(400, "\u041D\u0435\u043C\u0430\u0454 \u0437\u043C\u0456\u043D, \u0449\u043E \u0447\u0435\u043A\u0430\u044E\u0442\u044C \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F.");
    return { p, o, pend: JSON.parse(o.pending) };
  }
  app.post("/api/b2b/p/clients/:id/confirm", async (c) => {
    const { p, o } = await pendingOrder(c);
    await db.run(`UPDATE b2b_orders SET pending = '', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get("user"), "\u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0432 \u0437\u043C\u0456\u043D\u0438 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430");
    await tgAdmins(`\u2705 \xAB${h6(p.name)}\xBB \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0432 \u0437\u043C\u0456\u043D\u0438 \u0432 ${orderNo(o.id)} (${h6(o.client_name)})${o.status === "new" ? " \u2014 \u043C\u043E\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u0438 \u0432 CRM" : ""}.
${link(c, `b2bclients/${o.id}`)}`);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/p/clients/:id/reject", async (c) => {
    const { p, o, pend } = await pendingOrder(c);
    const bf = pend.before;
    const s = bf.supply_id ? await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [bf.supply_id]) : null;
    if (bf.supply_id && (!s || s.status === "cancelled")) throw fail(400, "\u041F\u043E\u043F\u0435\u0440\u0435\u0434\u043D\u044C\u043E\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0432\u0436\u0435 \u043D\u0435\u043C\u0430\u0454 \u2014 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u0438 \u044F\u043A \u0431\u0443\u043B\u043E \u043D\u0435 \u0432\u0438\u0439\u0434\u0435. \u0417\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.");
    if (s && s.status !== "open") {
      const left = new Map((await supplyLeft(s.id, o.id)).map((r) => [r.product_id, r.left]));
      for (const i of bf.items) if ((left.get(i.product_id) ?? 0) < i.qty) throw fail(400, `\u0423 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(s.id)} \u0443\u0436\u0435 \u043D\u0435\u043C\u0430\u0454 \xAB${i.name}\xBB (${i.qty} \u0448\u0442.) \u2014 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u0438 \u044F\u043A \u0431\u0443\u043B\u043E \u043D\u0435 \u0432\u0438\u0439\u0434\u0435. \u0417\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.`);
    }
    const curSupply = o.supply_id;
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, bf.items.map((i) => ({ ...i, article: i.article || "" }))),
      [
        `UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, comment = ?, total = ?, status = ?, crm_id = ?, crm_ext = ?, crm_status = ?, crm_sent_at = ?,
          crm_old = '', pending = '', updated_at = ? WHERE id = ?`,
        [bf.supply_id, bf.client_name, bf.client_phone, bf.ttn, bf.comment, bf.total, bf.status, bf.crm_id, bf.crm_ext, bf.crm_status, bf.crm_sent_at, nowIso(), o.id]
      ]
    ]);
    if (s?.status === "open") await rebuildOpen(s.id);
    if (curSupply && curSupply !== bf.supply_id) await rebuildOpen(curSupply);
    await log(o.id, c.get("user"), "\u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0432\u0456\u0434\u0445\u0438\u043B\u0438\u0432 \u0437\u043C\u0456\u043D\u0438 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430 \u2014 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u043E \u044F\u043A \u0431\u0443\u043B\u043E");
    await tgAdmins(`\u21A9\uFE0F \xAB${h6(p.name)}\xBB <b>\u0432\u0456\u0434\u0445\u0438\u043B\u0438\u0432</b> \u0437\u043C\u0456\u043D\u0438 \u0432 ${orderNo(o.id)} (${h6(bf.client_name)}) \u2014 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u043E \u044F\u043A \u0431\u0443\u043B\u043E.${pend.crm_old ? ` \u0421\u0442\u0430\u0440\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432 LP-CRM \u2116 ${h6(pend.crm_old)} \u0437\u043D\u043E\u0432\u0443 \u0447\u0438\u043D\u043D\u0435 \u2014 \u044F\u043A\u0449\u043E \u0432\u0438 \u0439\u043E\u0433\u043E \u0432\u0436\u0435 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u043B\u0438, \u0432\u0456\u0434\u043D\u043E\u0432\u0456\u0442\u044C.` : ""}
${link(c, `b2bclients/${o.id}`)}`);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/p/clients/:id/cancel", async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== "new") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u0435 \u0432 \u0440\u043E\u0431\u043E\u0442\u0443 \u2014 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u0439\u043E\u0433\u043E \u043C\u043E\u0436\u0435 \u043B\u0438\u0448\u0435 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440.");
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    if (o.supply_id) await rebuildOpen(o.supply_id);
    await log(o.id, c.get("user"), "\u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430");
    await tgAdmins(`\u274C <b>\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${orderNo(o.id)}</b> (\xAB${h6(p.name)}\xBB)
${link(c, `b2bclients/${o.id}`)}`);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/p/parse-label", async (c) => {
    const p = await myPartner(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw fail(400, "\u0424\u0430\u0439\u043B \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u2014 \u0434\u043E 5 \u041C\u0411.");
    const info = await labelInfo(bytes);
    const exceptId = parseInt(c.req.query("except"), 10) || 0;
    const dup = await labelDup(info, exceptId);
    const dupOut = dup ? (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? dup : { id: 0, number: "\u0456\u043D\u0448\u043E\u0433\u043E \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430", client_name: "\u2014" } : null;
    const np = info.np;
    if (!np) return c.json({ found: false, dup: dupOut, dup_text: dupOut ? dupText(dupOut) : "" });
    return c.json({ found: true, client_name: np.recipient, client_phone: np.phone ? `0${np.phone.slice(3)}` : "", ttn: np.ttn, address: np.address, dup: dupOut, dup_text: dupOut ? dupText(dupOut) : "" });
  });
  app.post("/api/b2b/p/clients/:id/files", async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== "new") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u0432 \u0440\u043E\u0431\u043E\u0442\u0456 \u2014 \u043D\u043E\u0432\u0438\u0439 \u0444\u0430\u0439\u043B \u043D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0443.");
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_files WHERE order_id = ?`, [o.id])).n >= 15) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 15 \u0444\u0430\u0439\u043B\u0456\u0432 \u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456.");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw fail(400, "\u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0444\u0430\u0439\u043B.");
    const typeId = parseInt(c.req.query("type"), 10) || 0;
    if (typeId) {
      const t = await db.get(`SELECT * FROM b2b_doc_types WHERE id = ? AND partner_id = ? AND active = 1`, [typeId, p.id]);
      if (!t) throw fail(404, "\u0422\u0430\u043A\u043E\u0433\u043E \u0432\u0438\u0434\u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u043D\u0435\u043C\u0430\u0454 \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443.");
      const { hash: hash2 } = await labelInfo(bytes);
      if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND hash = ?`, [o.id, hash2])) throw fail(409, "\u0426\u0435\u0439 \u0444\u0430\u0439\u043B \u0443\u0436\u0435 \u0434\u043E\u0434\u0430\u043D\u043E \u0434\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.");
      const f2 = await saveFile(c, o, "doc", bytes, { hash: hash2 });
      await db.run(`UPDATE b2b_files SET doc_type = ? WHERE id = ?`, [t.id, f2.id]);
      await log(o.id, c.get("user"), `\u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442: ${t.name}`);
      if (t.print) await hooks.afterDoc?.(o, f2, t).catch(() => 0);
      return c.json({ id: f2.id, warnings: [] });
    }
    const info = await labelInfo(bytes);
    const dup = await labelDup(info, o.id);
    if (dup) throw fail(409, dup.id && (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? dupText(dup) : "\u0422\u0430\u043A\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u043D\u0435 \u0432 \u0456\u043D\u0448\u043E\u043C\u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456.");
    if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' AND hash = ?`, [o.id, info.hash])) throw fail(409, "\u0426\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0434\u043E\u0434\u0430\u043D\u043E \u0434\u043E \u0446\u044C\u043E\u0433\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.");
    const f = await saveFile(c, o, "label", bytes, { hash: info.hash, ttn: info.ttn });
    const r = await hooks.afterLabel?.(o, f, c.get("user"));
    return c.json({ id: f.id, warnings: r?.warnings || [] });
  });
  app.delete("/api/b2b/p/clients/:id/files/:fid", async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== "new") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u0432 \u0440\u043E\u0431\u043E\u0442\u0456.");
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ? AND order_id = ? AND kind IN ('label', 'doc')`, [c.req.param("fid"), o.id]);
    if (!f) throw fail(404, "\u0424\u0430\u0439\u043B \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [f.id]], [`DELETE FROM b2b_files WHERE id = ?`, [f.id]]]);
    await log(o.id, c.get("user"), `\u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u0444\u0430\u0439\u043B \xAB${f.name}\xBB`);
    return c.json({ ok: true });
  });
  const VIEWS = {
    new: `o.status = 'new'`,
    crm: `o.status = 'crm'`,
    nosupply: `(o.supply_id IS NULL OR s.status = 'open') AND o.status != 'cancelled'`,
    cancelled: `o.status = 'cancelled'`
  };
  app.get("/api/b2b/clients", async (c) => {
    need(c, "b2b.admin");
    await refreshCrm();
    const f = listFilter(c, { client: true });
    const where = [`o.kind = 'client'`, ...f.where];
    const params = [...f.params];
    const v = c.req.query("view");
    const pid = parseInt(c.req.query("partner"), 10);
    if (VIEWS[v]) where.push(VIEWS[v]);
    if (pid) {
      where.push("o.partner_id = ?");
      params.push(pid);
    }
    const rows = await db.all(
      `SELECT o.*, s.status AS supply_status, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id JOIN b2b_partners p ON p.id = o.partner_id
       WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 300`,
      params
    );
    const cnt = await db.get(`SELECT SUM(o.status = 'new') AS new, SUM(o.status = 'crm') AS crm, SUM((o.supply_id IS NULL OR s.status = 'open') AND o.status != 'cancelled') AS nosupply,
      SUM(o.status = 'cancelled') AS cancelled FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id WHERE o.kind = 'client'`);
    return c.json({ rows: rows.map(publicOrder), counts: cnt || {}, crm: (await crmConfig()).on });
  });
  async function clientOrder(c) {
    const o = await orderOf(c.req.param("id"));
    if (o.kind !== "client") throw fail(404, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return o;
  }
  app.post("/api/b2b/clients/:id/crm", async (c) => {
    need(c, "b2b.admin");
    const o = await clientOrder(c);
    if (o.status !== "new" || o.crm_id) throw fail(400, o.status === "crm" || o.crm_id ? `\u0423\u0436\u0435 \u0432 CRM${o.crm_id ? `: \u2116 ${o.crm_id}` : ""}.` : "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    const k = await crmConfig();
    if (!k.on) throw fail(400, "\u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0443 \u0432 LP-CRM \u0449\u0435 \u043D\u0435 \u0432\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u043E. \u041A\u043E\u043B\u0438 \u043A\u043B\u044E\u0447 LP-CRM \u043E\u0442\u0440\u0438\u043C\u0430\u0454 \u0434\u043E\u0437\u0432\u0456\u043B \u043D\u0430 addNewOrder \u2014 \u0443\u0432\u0456\u043C\u043A\u043D\u0456\u0442\u044C \u0457\u0457 \u0432 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 CRM\xBB (\u0432\u043A\u043B\u0430\u0434\u043A\u0430 \xAB\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432\xBB). \u041F\u043E\u043A\u0438 \u0449\u043E \u0441\u0442\u0432\u043E\u0440\u0456\u0442\u044C \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432 CRM \u0432\u0440\u0443\u0447\u043D\u0443 \u0456 \u0432\u043F\u0438\u0448\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u043D\u043E\u043C\u0435\u0440.");
    if (!k.office) throw fail(400, "\u041D\u0435 \u0432\u043A\u0430\u0437\u0430\u043D\u043E ID \u0432\u0456\u0434\u0434\u0456\u043B\u0443 B2B \u0443 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 CRM\xBB.");
    if (!k.creds.subdomain || !k.creds.key) throw fail(400, "\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u043F\u0456\u0434\u0434\u043E\u043C\u0435\u043D \u0456 API-\u043A\u043B\u044E\u0447 \u0443 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445\xBB.");
    if (o.pending) throw fail(400, "\u041F\u0430\u0440\u0442\u043D\u0435\u0440 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0432 \u0437\u043C\u0456\u043D\u0438 \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 \u2014 \u043F\u0435\u0440\u0435\u0434\u0430\u0442\u0438 \u0432 CRM \u043C\u043E\u0436\u043D\u0430 \u043F\u0456\u0441\u043B\u044F \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F.");
    const missing = await missingDocs(o);
    if (missing.length) throw fail(400, `\u0411\u0440\u0430\u043A\u0443\u0454 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456\u0432: ${missing.join(", ")}. \u041F\u043E\u043F\u0440\u043E\u0441\u0456\u0442\u044C \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0434\u043E\u0434\u0430\u0442\u0438 \u0457\u0445 \u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 (\u0430\u0431\u043E \u043F\u0440\u0438\u0432\u2019\u044F\u0436\u0456\u0442\u044C \u043D\u043E\u043C\u0435\u0440 CRM \u0432\u0440\u0443\u0447\u043D\u0443).`);
    const code = newCode();
    const now = nowIso();
    const stale = new Date(Date.now() - SENDING_TTL_MS).toISOString();
    const claim = await db.run(
      `UPDATE b2b_orders SET crm_ext = ?, crm_sent_at = ? WHERE id = ? AND status = 'new' AND crm_id = '' AND (crm_sent_at = '' OR crm_sent_at IS NULL OR crm_sent_at < ?)`,
      [code, `sending:${now}`, o.id, `sending:${stale}`]
    );
    if (!claim.changes) throw fail(409, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u043D\u0430\u0434\u0441\u0438\u043B\u0430\u0454\u0442\u044C\u0441\u044F \u0432 CRM \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443 \u0437\u0430 \u0445\u0432\u0438\u043B\u0438\u043D\u0443.");
    const [items, p] = await Promise.all([
      db.all(`SELECT product_id, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [o.partner_id])
    ]);
    const { paid, comment } = await crmComment(o, p?.name || "");
    const address = /НП:\s*([^\n]+)/.exec(o.comment || "")?.[1]?.trim() || "";
    let res;
    try {
      res = await addNewOrder(fetchFn, k.addCreds, {
        code,
        office: k.office,
        bayer_name: o.client_name,
        phone: o.client_phone,
        comment,
        delivery: k.delivery,
        payment: paid ? k.paymentPaid : k.payment,
        notification: k.notification,
        // ТТН — у поле адреси доставки (окремого поля ТТН addNewOrder не має): менеджер переносить її в поле ТТН;
        // без ТТН — відділення з маркування.
        delivery_adress: o.ttn || address,
        ...k.ttnField && o.ttn ? { [k.ttnField]: o.ttn } : {},
        // Сайт-джерело: LP-CRM бере його з sender (serialize($_SERVER) у прикладі) — без нього «Не указан сайт-лендинг».
        sender: senderOf(c, k.site),
        site: k.site || new URL(c.req.url).host,
        products: items.map((i) => ({ product_id: i.product_id, price: i.price, count: i.qty }))
      });
    } catch (e) {
      await db.run(`UPDATE b2b_orders SET crm_sent_at = '' WHERE id = ?`, [o.id]);
      if (e.pending) throw e;
      throw fail(502, e.message);
    }
    if (!res.ok) {
      await db.run(`UPDATE b2b_orders SET crm_sent_at = '' WHERE id = ?`, [o.id]);
      await log(o.id, c.get("user"), `LP-CRM \u043D\u0435 \u043F\u0440\u0438\u0439\u043D\u044F\u043B\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F: ${res.error.slice(0, 200)}`);
      throw fail(400, `LP-CRM \u043D\u0435 \u043F\u0440\u0438\u0439\u043D\u044F\u043B\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F: ${res.error}`);
    }
    await db.run(
      `UPDATE b2b_orders SET status = 'crm', crm_id = '', crm_sent_at = ?, crm_status = '\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E', crm_checked_at = '', updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), o.id]
    );
    await refreshCrm({ ids: [o.id] });
    const crmId = (await db.get(`SELECT crm_id FROM b2b_orders WHERE id = ?`, [o.id]))?.crm_id || "";
    await log(o.id, c.get("user"), `\u0434\u043E\u0434\u0430\u043D\u043E \u0432 LP-CRM${crmId ? `: \u2116 ${crmId}` : ` (\u043A\u043E\u0434 ${code}; \u043D\u043E\u043C\u0435\u0440 \u0437\u2019\u044F\u0432\u0438\u0442\u044C\u0441\u044F \u043F\u0456\u0441\u043B\u044F \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0443)`}`);
    await tgPartner(o.partner_id, `\u{1F69A} \u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} (${h6(o.client_name)}) \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0432 \u0440\u043E\u0431\u043E\u0442\u0443${crmId ? `, \u2116 \u0443 CRM ${crmId}` : ""}.
${link(c, `pclients/${o.id}`)}`);
    await warnUnpaidShipped(c, o);
    await supplyInWork(o.supply_id, c).catch(() => 0);
    return c.json({ ok: true, crm_id: crmId, code });
  });
  app.put("/api/b2b/clients/:id", async (c) => {
    need(c, "b2b.admin");
    const o = await clientOrder(c);
    if (o.status === "cancelled") throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    const b = await c.req.json();
    const val = String(b.crm_id ?? "").replace(/\s/g, "");
    const isCode = CODE_RE.test(val);
    if (val && !isCode && !ID_RE.test(val)) throw fail(400, "\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F LP-CRM \u2014 \u043B\u0438\u0448\u0435 \u0446\u0438\u0444\u0440\u0438.");
    if (val && o.pending) throw fail(400, "\u041F\u0430\u0440\u0442\u043D\u0435\u0440 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0432 \u0437\u043C\u0456\u043D\u0438 \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 \u2014 \u043F\u0440\u0438\u0432\u2019\u044F\u0437\u0430\u0442\u0438 \u043D\u043E\u043C\u0435\u0440 CRM \u043C\u043E\u0436\u043D\u0430 \u043F\u0456\u0441\u043B\u044F \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043D\u044F.");
    const crmId = isCode ? "" : val;
    const crmExt = isCode ? val : "";
    const status = val ? "crm" : "new";
    await db.run(
      `UPDATE b2b_orders SET crm_id = ?, crm_ext = ?, crm_sent_at = CASE WHEN ? = '' THEN '' ELSE crm_sent_at END, status = ?, crm_status = '', crm_checked_at = '', updated_at = ? WHERE id = ?`,
      [crmId, crmExt, val, status, nowIso(), o.id]
    );
    const was = o.crm_id || o.crm_ext;
    await log(o.id, c.get("user"), val ? `${was && was !== val ? `\u0437\u0430\u043C\u0456\u043D\u0435\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F LP-CRM (\u0431\u0443\u043B\u043E ${was}) \u043D\u0430` : "\u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F LP-CRM"} ${isCode ? `\u043A\u043E\u0434 ${val}` : `\u2116 ${val}`}` : "\u0432\u0456\u0434\u0432\u2019\u044F\u0437\u0430\u043D\u043E \u043D\u043E\u043C\u0435\u0440 LP-CRM");
    if (val && val !== o.crm_id && val !== o.crm_ext) {
      await refreshCrm({ ids: [o.id] });
      const num5 = (await db.get(`SELECT crm_id FROM b2b_orders WHERE id = ?`, [o.id]))?.crm_id || "";
      if (!isCode && num5) await hooks.crmLinked?.(o.id, num5).catch(() => 0);
      if (o.status === "new") await warnUnpaidShipped(c, o);
      const relinked = Boolean(o.crm_id || o.crm_ext);
      await tgPartner(o.partner_id, relinked ? `\u{1F501} \u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} (${h6(o.client_name)}): \u043D\u043E\u043C\u0435\u0440 \u0443 CRM \u0437\u043C\u0456\u043D\u0435\u043D\u043E${num5 ? ` \u043D\u0430 ${num5}` : ""}.
${link(c, `pclients/${o.id}`)}` : `\u{1F69A} \u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} (${h6(o.client_name)}) \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E \u0432 \u0440\u043E\u0431\u043E\u0442\u0443${num5 ? `, \u2116 \u0443 CRM ${num5}` : ""}.
${link(c, `pclients/${o.id}`)}`);
      await supplyInWork(o.supply_id, c).catch(() => 0);
    }
    return c.json({ ok: true });
  });
  app.post("/api/b2b/clients/:id/refresh", async (c) => {
    need(c, "b2b.admin");
    const o = await clientOrder(c);
    if (!o.crm_id && !o.crm_ext) throw fail(400, "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0449\u0435 \u043D\u0435 \u043F\u0440\u0438\u0432\u2019\u044F\u0437\u0430\u043D\u0435 \u0434\u043E LP-CRM.");
    await refreshCrm({ ids: [o.id] });
    return c.json({ ok: true });
  });
  app.post("/api/b2b/clients/:id/paid", async (c) => {
    need(c, "b2b.admin");
    const o = await clientOrder(c);
    if (o.supply_id) throw fail(400, `\u041E\u043F\u043B\u0430\u0442\u0430 \u2014 \u0437\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0435\u044E ${orderNo(o.supply_id)}${(await supplyOf(o.supply_id))?.status === "open" ? " (\u0441\u043F\u0435\u0440\u0448\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0444\u043E\u0440\u043C\u0443\u0454 \u043D\u0430 \u043D\u0435\u0457 \u0440\u0430\u0445\u0443\u043D\u043E\u043A)" : ""}.`);
    const { paid } = await c.req.json();
    const u = c.get("user");
    const now = nowIso();
    if (paid) await db.run(`UPDATE b2b_orders SET paid_amount = total, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?`, [now, userName5(u), now, o.id]);
    else await db.run(`UPDATE b2b_orders SET paid_amount = 0, paid_at = '', paid_by = '', updated_at = ? WHERE id = ?`, [now, o.id]);
    await log(o.id, u, paid ? "\u043F\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043E \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB \u0432\u0440\u0443\u0447\u043D\u0443" : "\u0437\u043D\u044F\u0442\u043E \u043F\u043E\u0437\u043D\u0430\u0447\u043A\u0443 \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB");
    if (paid) await tgPartner(o.partner_id, `\u2705 <b>\u041E\u043F\u043B\u0430\u0442\u0443 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E</b>: \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} (${h6(o.client_name)}) \u2014 ${uah3(o.total)}`);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/clients/:id/cancel", async (c) => {
    need(c, "b2b.admin");
    const o = await clientOrder(c);
    if (o.status === "cancelled") throw fail(400, "\u0423\u0436\u0435 \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    if (o.supply_id) await rebuildOpen(o.supply_id);
    await log(o.id, c.get("user"), "\u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0441\u043A\u0430\u0441\u0443\u0432\u0430\u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430");
    await tgPartner(o.partner_id, `\u274C \u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} (${h6(o.client_name)}) \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u043E\u043C.`);
    return c.json({ ok: true, inCrm: !!o.crm_id });
  });
  return { refreshCrm };
}

// src/modules/b2b/stats.js
var DAY = 864e5;
var addDays2 = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
var daysBetween2 = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY) + 1;
function mountB2bStats(app, { db, myPartner }) {
  async function names() {
    const [cats, brands] = await Promise.all([
      db.all(`SELECT id, name FROM an_categories`).catch(() => []),
      db.all(`SELECT id, name FROM an_brands`).catch(() => [])
    ]);
    return { cat: new Map(cats.map((r) => [r.id, r.name])), brand: new Map([...brands.map((r) => [r.id, r.name]), [0, "\u0406\u043D\u0448\u0456"]]) };
  }
  async function report(partnerId, q) {
    const today2 = kyivDayOf((/* @__PURE__ */ new Date()).toISOString());
    const to = isDay2(q.to) ? q.to : today2;
    const from = isDay2(q.from) && q.from <= to ? q.from : addDays2(to, -29);
    const days = Math.min(daysBetween2(from, to), 400);
    const prevTo = addDays2(from, -1);
    const prevFrom = addDays2(prevTo, -(days - 1));
    const byPartner = partnerId ? "AND o.partner_id = ?" : "";
    const pp = partnerId ? [partnerId] : [];
    const orders = await db.all(
      `SELECT o.id, o.partner_id, o.kind, o.status, o.supply_id, o.total, o.paid_amount, o.paid_at, o.created_at, o.crm_status, s.status AS supply_status
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('cancelled', 'draft') ${byPartner}`,
      [kyivDayStartIso(prevFrom), kyivDayStartIso(nextDay(to)), ...pp]
    );
    for (const o of orders) {
      o.day = kyivDayOf(o.created_at);
      o.cur = o.day >= from;
    }
    const cur = orders.filter((o) => o.cur);
    const prev = orders.filter((o) => !o.cur);
    const items = cur.length ? await db.all(
      `SELECT order_id, product_id, name, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(cur.map((o) => o.id))]
    ) : [];
    const prevItems = prev.length ? await db.all(
      `SELECT order_id, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(prev.filter((o) => o.kind === "client").map((o) => o.id))]
    ) : [];
    const kindOf3 = new Map(orders.map((o) => [o.id, o.kind]));
    const sales = (list, its) => {
      const ids = new Set(list.filter((o) => o.kind === "client").map((o) => o.id));
      const li = its.filter((i) => ids.has(i.order_id));
      const sum = round2(list.filter((o) => o.kind === "client").reduce((t, o) => t + o.total, 0));
      const rrp = round2(li.reduce((t, i) => t + (i.rrp || i.price) * i.qty, 0));
      const cnt = ids.size;
      return { cnt, units: li.reduce((t, i) => t + i.qty, 0), sum, rrp, earn: round2(rrp - sum), avg: cnt ? round2(sum / cnt) : 0, perDay: round2(cnt / days) };
    };
    const supplies = (list) => {
      const s = list.filter((o) => o.kind === "supply");
      return { cnt: s.length, sum: round2(s.reduce((t, o) => t + o.total, 0)), paid: round2(s.filter((o) => ["paid", "done"].includes(o.status)).reduce((t, o) => t + o.total, 0)) };
    };
    const series = [];
    const byDay = /* @__PURE__ */ new Map();
    for (let d = from; d <= to && series.length < 400; d = nextDay(d)) {
      const r = { d, cnt: 0, sum: 0, supply: 0 };
      series.push(r);
      byDay.set(d, r);
    }
    for (const o of cur) {
      const r = byDay.get(o.day);
      if (!r) continue;
      if (o.kind === "client") {
        r.cnt++;
        r.sum = round2(r.sum + o.total);
      } else r.supply = round2(r.supply + o.total);
    }
    const weekdays = [0, 0, 0, 0, 0, 0, 0];
    for (const o of cur) if (o.kind === "client") weekdays[((/* @__PURE__ */ new Date(`${o.day}T12:00:00Z`)).getUTCDay() + 6) % 7]++;
    const clientItems = items.filter((i) => kindOf3.get(i.order_id) === "client");
    const pids = [...new Set(clientItems.map((i) => i.product_id))];
    const meta = pids.length ? new Map((await db.all(
      `SELECT c.product_id, c.brand_id, COALESCE(p.cat_manual, p.category_id) AS cat FROM b2b_catalog c LEFT JOIN an_products p ON p.product_id = c.product_id
       WHERE c.product_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(pids)]
    ).catch(() => [])).map((r) => [r.product_id, r])) : /* @__PURE__ */ new Map();
    const nm = await names();
    const agg = (keyOf, nameOf) => {
      const m = /* @__PURE__ */ new Map();
      for (const i of clientItems) {
        const k = keyOf(i);
        const r = m.get(k) || { key: k, name: nameOf(i, k), units: 0, sum: 0, rrp: 0, orders: /* @__PURE__ */ new Set() };
        r.units += i.qty;
        r.sum += i.price * i.qty;
        r.rrp += (i.rrp || i.price) * i.qty;
        r.orders.add(i.order_id);
        m.set(k, r);
      }
      return [...m.values()].map((r) => ({
        key: r.key,
        name: r.name,
        units: r.units,
        sum: round2(r.sum),
        earn: round2(r.rrp - r.sum),
        orders: r.orders.size,
        marginPct: r.rrp ? round2((r.rrp - r.sum) / r.rrp * 100) : 0
      })).sort((a, b) => b.sum - a.sum);
    };
    const products = agg((i) => i.product_id, (i) => i.name).slice(0, 100);
    const categories = agg((i) => meta.get(i.product_id)?.cat || 0, (i, k) => nm.cat.get(k) || "\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457");
    const brands = agg((i) => meta.get(i.product_id)?.brand_id ?? 0, (i, k) => nm.brand.get(k) || "\u0406\u043D\u0448\u0456");
    const crm = /* @__PURE__ */ new Map();
    for (const o of cur) if (o.kind === "client") {
      const k = o.crm_status || (o.status === "crm" ? "\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E" : "\u0429\u0435 \u043D\u0435 \u0432 CRM");
      crm.set(k, (crm.get(k) || 0) + 1);
    }
    const [debt, stockIn, stockOut] = await Promise.all([
      db.get(`SELECT SUM(CASE WHEN o.status = 'invoice_wait' THEN o.total ELSE 0 END) AS wait,
          SUM(CASE WHEN o.status IN ('pay_wait', 'partial') THEN o.total - o.paid_amount ELSE 0 END) AS due,
          SUM(CASE WHEN o.status IN ('pay_wait', 'partial') THEN 1 ELSE 0 END) AS due_cnt
        FROM b2b_orders o WHERE o.kind = 'supply' AND o.status IN ('invoice_wait', 'pay_wait', 'partial') ${byPartner}`, pp),
      db.get(`SELECT SUM(i.qty) AS units, SUM(i.qty * i.price) AS sum FROM b2b_order_items i JOIN b2b_orders o ON o.id = i.order_id
        WHERE o.kind = 'supply' AND o.status NOT IN ('cancelled', 'draft') ${byPartner}`, pp),
      db.get(`SELECT SUM(i.qty) AS units, SUM(i.qty * i.price) AS sum FROM b2b_order_items i JOIN b2b_orders o ON o.id = i.order_id
        WHERE o.kind = 'client' AND o.status != 'cancelled' AND o.supply_id IS NOT NULL ${byPartner}`, pp)
    ]);
    const noSupply = cur.filter((o) => o.kind === "client" && (!o.supply_id || o.supply_status === "open")).length;
    const unpaidClients = cur.filter((o) => o.kind === "client" && !(o.supply_id ? ["paid", "done"].includes(o.supply_status) : o.paid_at)).length;
    const out = {
      period: { from, to, days },
      prev: { from: prevFrom, to: prevTo },
      sales: sales(cur, items),
      salesPrev: sales(prev, prevItems),
      supplies: supplies(cur),
      suppliesPrev: supplies(prev),
      noSupply,
      unpaidClients,
      debt: { wait: round2(debt?.wait || 0), due: round2(debt?.due || 0), dueCnt: debt?.due_cnt || 0 },
      stock: { units: (stockIn?.units || 0) - (stockOut?.units || 0), sum: round2((stockIn?.sum || 0) - (stockOut?.sum || 0)) },
      series,
      weekdays,
      products,
      categories,
      brands,
      crm: [...crm].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n)
    };
    if (!partnerId) {
      const ps = new Map((await db.all(`SELECT id, name FROM b2b_partners`)).map((p) => [p.id, { id: p.id, name: p.name, cnt: 0, sum: 0, supply: 0 }]));
      for (const o of cur) {
        const r = ps.get(o.partner_id);
        if (!r) continue;
        if (o.kind === "client") {
          r.cnt++;
          r.sum = round2(r.sum + o.total);
        } else r.supply = round2(r.supply + o.total);
      }
      out.partners = [...ps.values()].filter((r) => r.cnt || r.supply).sort((a, b) => b.sum + b.supply - (a.sum + a.supply));
    }
    return out;
  }
  app.get("/api/b2b/p/stats", async (c) => {
    const p = await myPartner(c);
    return c.json(await report(p.id, c.req.query()));
  });
  app.get("/api/b2b/stats", async (c) => {
    need(c, "b2b.admin");
    const pid = parseInt(c.req.query("partner"), 10) || null;
    if (pid && !await db.get(`SELECT id FROM b2b_partners WHERE id = ?`, [pid])) throw fail(404, "\u041F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return c.json(await report(pid, c.req.query()));
  });
}

// src/modules/b2b/prices.js
var h4 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var nf3 = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var m2 = (n) => nf3.format(Number(n) || 0);
var pct = (v) => `${String(round2(v)).replace(".", ",")}%`;
var arrow = (a, b) => b > a ? "\u25B2" : b < a ? "\u25BC" : "";
var MAX_CHUNK = 3800;
var MAX_CHUNKS = 6;
function mountB2bPrices(app, { db, services, partnerPrice: partnerPrice2 }) {
  async function brandNames() {
    const rows = await db.all(`SELECT id, name FROM an_brands`).catch(() => []);
    return new Map([...rows.map((r) => [r.id, r.name]), [0, "\u0406\u043D\u0448\u0456"]]);
  }
  async function changesOf(p, names) {
    const since = p.prices_sent_at || p.created_at || "";
    const [margins, mlog] = await Promise.all([
      db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id]),
      db.all(`SELECT brand_id, old_margin, new_margin FROM b2b_margin_log WHERE partner_id = ? AND at > ? ORDER BY id`, [p.id, since])
    ]);
    const cur = new Map(margins.map((m) => [m.brand_id, m.margin]));
    const firstOld = /* @__PURE__ */ new Map();
    for (const r of mlog) if (!firstOld.has(r.brand_id)) firstOld.set(r.brand_id, r.old_margin);
    const opened = [];
    const closed = [];
    const marginChanged = [];
    for (const [brand, old] of firstOld) {
      const now = cur.has(brand) ? cur.get(brand) : null;
      if (old == null && now != null) opened.push({ brand, name: names.get(brand) || "\u0406\u043D\u0448\u0456", margin: now });
      else if (old != null && now == null) closed.push({ brand, name: names.get(brand) || "\u0406\u043D\u0448\u0456" });
      else if (old != null && now != null && round2(old) !== round2(now)) marginChanged.push({ brand, name: names.get(brand) || "\u0406\u043D\u0448\u0456", old, now });
    }
    const oldMargin = (brand) => {
      const mc = marginChanged.find((x) => x.brand === brand);
      return mc ? mc.old : cur.get(brand);
    };
    const brands = [...cur.keys()].filter((b) => !opened.some((o) => o.brand === b));
    if (!brands.length) return { since, opened, closed, marginChanged, products: [] };
    const plog = await db.all(
      `SELECT l.product_id, l.old_rrp FROM b2b_price_log l JOIN b2b_catalog c ON c.product_id = l.product_id
       WHERE l.at > ? AND c.hidden = 0 AND c.brand_id IN (SELECT value FROM json_each(?)) ORDER BY l.id`,
      [since, JSON.stringify(brands)]
    );
    const oldRrp = /* @__PURE__ */ new Map();
    for (const r of plog) if (!oldRrp.has(r.product_id)) oldRrp.set(r.product_id, r.old_rrp);
    const mcBrands = marginChanged.map((x) => x.brand);
    const rows = oldRrp.size || mcBrands.length ? await db.all(
      `SELECT product_id, name, article, rrp, brand_id FROM b2b_catalog WHERE hidden = 0 AND rrp > 0
         AND (product_id IN (SELECT value FROM json_each(?)) OR brand_id IN (SELECT value FROM json_each(?)))
         AND brand_id IN (SELECT value FROM json_each(?)) ORDER BY brand_id, name`,
      [JSON.stringify([...oldRrp.keys()]), JSON.stringify(mcBrands), JSON.stringify(brands)]
    ) : [];
    const products = [];
    for (const r of rows) {
      const o = oldRrp.has(r.product_id) ? oldRrp.get(r.product_id) : r.rrp;
      const oldPrice = partnerPrice2(o, oldMargin(r.brand_id));
      const newPrice = partnerPrice2(r.rrp, cur.get(r.brand_id));
      if (round2(o) === round2(r.rrp) && oldPrice === newPrice) continue;
      products.push({ id: r.product_id, name: r.name, article: r.article, brand: names.get(r.brand_id) || "\u0406\u043D\u0448\u0456", oldRrp: o, newRrp: r.rrp, oldPrice, newPrice });
    }
    return { since, opened, closed, marginChanged, products };
  }
  const empty = (ch) => !ch.products.length && !ch.opened.length && !ch.closed.length && !ch.marginChanged.length;
  function messages(p, ch) {
    const head = `\u{1F4B2} <b>\u0417\u043C\u0456\u043D\u0430 \u0446\u0456\u043D</b> \u2014 \xAB${h4(p.name)}\xBB`;
    const blocks = [];
    if (ch.marginChanged.length) blocks.push(`<b>\u0412\u0430\u0448\u0430 \u0437\u043D\u0438\u0436\u043A\u0430 \u0432\u0456\u0434 \u0420\u0420\u0426:</b>
${ch.marginChanged.map((x) => `${h4(x.name)}: ${pct(x.old)} \u2192 <b>${pct(x.now)}</b>`).join("\n")}`);
    if (ch.opened.length) blocks.push(`<b>\u041D\u043E\u0432\u0456 \u0431\u0440\u0435\u043D\u0434\u0438 \u0434\u043B\u044F \u0432\u0430\u0441:</b>
${ch.opened.map((x) => `${h4(x.name)} \u2014 \u0437\u043D\u0438\u0436\u043A\u0430 ${pct(x.margin)} \u0432\u0456\u0434 \u0420\u0420\u0426 (\u0442\u043E\u0432\u0430\u0440\u0438 \u2014 \u0443 \u043A\u0430\u0442\u0430\u043B\u043E\u0437\u0456)`).join("\n")}`);
    if (ch.closed.length) blocks.push(`<b>\u0411\u0456\u043B\u044C\u0448\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0456:</b> ${ch.closed.map((x) => h4(x.name)).join(", ")}`);
    const lines = ch.products.map((x) => `${h4(x.name)}${x.article ? ` (${h4(x.article)})` : ""}
   \u0420\u0420\u0426 ${m2(x.oldRrp)} \u2192 <b>${m2(x.newRrp)}</b> ${arrow(x.oldRrp, x.newRrp)} \xB7 \u0432\u0430\u0448\u0430 \u0446\u0456\u043D\u0430 ${m2(x.oldPrice)} \u2192 <b>${m2(x.newPrice)}</b> \u0433\u0440\u043D ${arrow(x.oldPrice, x.newPrice)}`);
    const out = [];
    let cur = [head, ...blocks].join("\n\n");
    if (lines.length) cur += `

<b>\u0426\u0456\u043D\u0438 (${lines.length}):</b>`;
    for (const [i, l] of lines.entries()) {
      if (cur.length + l.length + 1 > MAX_CHUNK) {
        if (out.length === MAX_CHUNKS - 1) {
          cur += `

\u2026\u0456 \u0449\u0435 ${lines.length - i} \u2014 \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u0456 \u0446\u0456\u043D\u0438 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0437\u0456 \u043A\u0430\u0431\u0456\u043D\u0435\u0442\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430.`;
          break;
        }
        out.push(cur);
        cur = `${head} (\u043F\u0440\u043E\u0434\u043E\u0432\u0436\u0435\u043D\u043D\u044F)`;
      }
      cur += `
${l}`;
    }
    out.push(cur);
    return out;
  }
  async function partnersWithChanges(ids = null) {
    const names = await brandNames();
    const list = await db.all(`SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.active = 1 AND u.tg_chat_id != '') AS tg_users
      FROM b2b_partners p WHERE p.active = 1 AND COALESCE(p.deleted_at, '') = '' ORDER BY p.name`);
    const out = [];
    for (const p of list) {
      if (ids && !ids.includes(p.id)) continue;
      const ch = await changesOf(p, names);
      out.push({ p, ch });
    }
    return out;
  }
  app.get("/api/b2b/price-changes", async (c) => {
    need(c, "b2b.admin");
    const rows = await partnersWithChanges();
    return c.json(rows.map(({ p, ch }) => ({
      id: p.id,
      name: p.name,
      since: ch.since,
      products: ch.products.length,
      brands: ch.marginChanged.length + ch.opened.length + ch.closed.length,
      empty: empty(ch),
      group: p.tg_group_title || (p.tg_group ? "\u0433\u0440\u0443\u043F\u0430" : ""),
      tgUsers: p.tg_users,
      preview: empty(ch) ? [] : messages(p, ch)
    })));
  });
  app.post("/api/b2b/price-changes/send", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(b.partner_ids) ? b.partner_ids.map(Number).filter(Boolean) : null;
    const results = [];
    for (const { p, ch } of await partnersWithChanges(ids)) {
      if (empty(ch)) continue;
      const to = p.tg_group ? { chatIds: [p.tg_group] } : { partnerId: p.id };
      let sent = 0;
      for (const text of messages(p, ch)) sent += await services.notify?.sendText(to, text).catch(() => 0) || 0;
      if (sent) await db.run(`UPDATE b2b_partners SET prices_sent_at = ? WHERE id = ?`, [nowIso(), p.id]);
      results.push({ id: p.id, name: p.name, sent: sent > 0, where: p.tg_group ? "group" : "users", products: ch.products.length });
    }
    return c.json({ results });
  });
  const ANN_MAX = 3500;
  const annText = (raw2) => `\u{1F4E2} ${h4(String(raw2 || "").trim()).slice(0, ANN_MAX)}`;
  app.get("/api/b2b/announce/targets", async (c) => {
    need(c, "b2b.admin");
    const rows = await db.all(`SELECT p.id, p.name, p.tg_group, p.tg_group_title,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.active = 1 AND u.tg_chat_id != '') AS tg_users
      FROM b2b_partners p WHERE p.active = 1 AND COALESCE(p.deleted_at, '') = '' ORDER BY p.name`);
    return c.json(rows.map((p) => ({ id: p.id, name: p.name, group: p.tg_group ? p.tg_group_title || "\u0433\u0440\u0443\u043F\u0430" : "", tgUsers: p.tg_users })));
  });
  app.post("/api/b2b/announce", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json().catch(() => ({}));
    const raw2 = String(b.text || "").trim();
    if (!raw2) throw fail(400, "\u041D\u0430\u043F\u0438\u0448\u0456\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u043E\u0433\u043E\u043B\u043E\u0448\u0435\u043D\u043D\u044F.");
    if (raw2.length > ANN_MAX) throw fail(400, `\u0422\u0435\u043A\u0441\u0442 \u0437\u0430\u0434\u043E\u0432\u0433\u0438\u0439 \u2014 \u0434\u043E ${ANN_MAX} \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.`);
    if (!b.groups && !b.users) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C, \u043A\u0443\u0434\u0438 \u043D\u0430\u0434\u0441\u0438\u043B\u0430\u0442\u0438: \u0443 \u0433\u0440\u0443\u043F\u0438 \u0442\u0430/\u0430\u0431\u043E \u0432 \u0431\u043E\u0442.");
    const p = await db.get(`SELECT id, name, tg_group FROM b2b_partners WHERE id = ? AND active = 1 AND COALESCE(deleted_at, '') = ''`, [Number(b.partner_id) || 0]);
    if (!p) throw fail(404, "\u041F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const text = annText(raw2);
    const group = b.groups && p.tg_group ? await services.notify?.sendText({ chatIds: [p.tg_group] }, text).catch(() => 0) || 0 : 0;
    const users = b.users ? await services.notify?.sendText({ partnerId: p.id }, text).catch(() => 0) || 0 : 0;
    return c.json({ id: p.id, group, users });
  });
}

// src/modules/b2b/tgdocs.js
var KIND_NAME = { invoice: "\u0420\u0430\u0445\u0443\u043D\u043E\u043A", waybill: "\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430" };
var h5 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var nf4 = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var m22 = (n) => nf4.format(Number(n) || 0);
var UNDO_MIN = 15;
var MAX_FILE2 = 5 * 1024 * 1024;
var PAGE = 8;
var kyivToday = () => (/* @__PURE__ */ new Date()).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
var fmtDate = (d) => d ? d.split("-").reverse().join(".") : "";
var phoneFmt = (p) => /^380\d{9}$/.test(p || "") ? `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p || "";
function mountB2bTgDocs(app, { db, services, orders, hooks }) {
  const notify = () => services.notify;
  const tgApi = (method, body) => notify()?.api(method, body);
  const set = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  const isPdf = (bytes) => bytes?.[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70;
  app.get("/api/b2b/labels-group", async (c) => {
    need(c, "b2b.admin");
    const s = await loadSettings(db);
    return c.json({ chat: s.b2b_labels_chat || "", title: s.b2b_labels_title || "", bot: s.tg_bot || "" });
  });
  app.post("/api/b2b/labels-group", async (c) => {
    need(c, "b2b.admin");
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, "Telegram-\u0431\u043E\u0442\u0430 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E (\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u2192 Telegram).");
    const code = randomToken(6);
    await set("b2b_labels_code", `${code}|${Date.now() + 30 * 6e4}`);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete("/api/b2b/labels-group", async (c) => {
    need(c, "b2b.admin");
    await db.batch([[`DELETE FROM settings WHERE key IN ('b2b_labels_chat', 'b2b_labels_title', 'b2b_labels_code')`, []]]);
    return c.json({ ok: true });
  });
  async function linkLabelsGroup(code, chat, title) {
    const s = await loadSettings(db);
    const [want, exp] = String(s.b2b_labels_code || "").split("|");
    if (!want || want !== code || (Number(exp) || 0) < Date.now()) return "";
    await db.batch([
      [`INSERT INTO settings (key, value) VALUES ('b2b_labels_chat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [chat]],
      [`INSERT INTO settings (key, value) VALUES ('b2b_labels_title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(title).slice(0, 120)]],
      [`DELETE FROM settings WHERE key = 'b2b_labels_code'`, []]
    ]);
    return "\u2705 \u0413\u0440\u0443\u043F\u0443 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E \u0434\u043B\u044F <b>\u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u044C</b>: \u0441\u044E\u0434\u0438 \u043D\u0430\u0434\u0445\u043E\u0434\u0438\u0442\u0438\u043C\u0443\u0442\u044C \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 B2B \u0437 \u041F\u0406\u0411 \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u0456 \u2116 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0432 CRM.";
  }
  const labelsChat = async () => (await db.get(`SELECT value FROM settings WHERE key = 'b2b_labels_chat'`))?.value || "";
  const labelCaption = (o, extra = "") => `\u{1F3F7} <b>${h5(o.client_name)}</b> \xB7 ${o.crm_id ? `CRM \u2116 <b>${h5(o.crm_id)}</b>` : "<i>\u0449\u0435 \u043D\u0435 \u0432 CRM</i>"} \xB7 ${orderNo(o.id)}${o.ttn ? ` \xB7 \u0422\u0422\u041D ${h5(o.ttn)}` : ""}${extra}`;
  async function afterLabel(o, f, _user, { fileId = "", replaced = false } = {}) {
    const warnings = [];
    let np = null;
    if (f.bytes && isPdf(f.bytes)) np = parseNpLabel(await pdfText(f.bytes));
    if (np?.ttn) {
      if (!o.ttn) {
        await db.run(`UPDATE b2b_orders SET ttn = ?, updated_at = ? WHERE id = ?`, [np.ttn, nowIso(), o.id]);
        await orders.log(o.id, { name: "Telegram" }, `\u0422\u0422\u041D ${np.ttn} \u2014 \u0437 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F`);
        o = { ...o, ttn: np.ttn };
      } else if (np.ttn !== o.ttn) warnings.push(`\u0422\u0422\u041D \u0443 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u0456 ${np.ttn} \u043D\u0435 \u0437\u0431\u0456\u0433\u0430\u0454\u0442\u044C\u0441\u044F \u0456\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F\u043C (${o.ttn})`);
      if (np.phone && o.client_phone && np.phone !== o.client_phone) warnings.push(`\u0442\u0435\u043B\u0435\u0444\u043E\u043D \u043E\u0434\u0435\u0440\u0436\u0443\u0432\u0430\u0447\u0430 ${phoneFmt(np.phone)} \u2260 \u0442\u0435\u043B\u0435\u0444\u043E\u043D \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${phoneFmt(o.client_phone)}`);
    }
    const chat = await labelsChat();
    if (chat) {
      const extra = `${replaced ? " \xB7 <b>\u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043E</b>" : ""}${np?.rozetka ? ` \xB7 \u0420\u043E\u0437\u0435\u0442\u043A\u0430 ${h5(np.rozetka)}` : ""}${warnings.length ? `
\u26A0\uFE0F ${h5(warnings.join("; "))}` : ""}`;
      const sent = await notify()?.sendFile({ chatIds: [chat] }, fileId ? { fileId } : f, labelCaption(o, extra)).catch(() => 0);
      if (sent) await orders.log(o.id, { name: "Telegram" }, "\u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u043D\u043E \u0432 \u0433\u0440\u0443\u043F\u0443 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u044C");
    }
    return { warnings, ttn: np?.ttn || "" };
  }
  async function crmLinked(orderId, num4) {
    const chat = await labelsChat();
    if (!chat) return;
    const o = await db.get(`SELECT id, client_name, ttn, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = b2b_orders.id AND f.kind = 'label') AS labels FROM b2b_orders WHERE id = ?`, [orderId]);
    if (!o?.labels) return;
    await notify()?.sendText({ chatIds: [chat] }, `\u{1F517} ${orderNo(o.id)} \xB7 <b>${h5(o.client_name)}</b> \u2192 CRM \u2116 <b>${h5(num4)}</b>${o.ttn ? ` \xB7 \u0422\u0422\u041D ${h5(o.ttn)}` : ""}`).catch(() => 0);
  }
  async function tgGroupFile(msg, base) {
    const chat = String(msg.chat.id);
    const reply = (text) => tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_to_message_id: msg.message_id }).catch(() => 0);
    const p = await db.get(`SELECT id, name FROM b2b_partners WHERE tg_group = ? AND COALESCE(deleted_at, '') = ''`, [chat]);
    if (!p) return;
    const replied = String(msg.reply_to_message?.text || msg.reply_to_message?.caption || "");
    const id = /B2B-(\d+)/.exec(replied)?.[1];
    if (!id || !/замовлення клієнта/i.test(replied)) {
      await reply("\u041C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0434\u043E\u0434\u0430\u0454\u0442\u044C\u0441\u044F <b>\u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0434\u044E \u043D\u0430 \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F \u043F\u0440\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430</b> (\u{1F4E6} \u041D\u043E\u0432\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 B2B-\u2026).");
      return;
    }
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ? AND partner_id = ? AND kind = 'client'`, [Number(id), p.id]);
    if (!o) {
      await reply("\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
      return;
    }
    if (o.status === "cancelled") {
      await reply(`\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F ${orderNo(o.id)} \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u2014 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u043D\u0435 \u0434\u043E\u0434\u0430\u043D\u043E.`);
      return;
    }
    const file = fileOf(msg);
    if (file.size > MAX_FILE2) {
      await reply("\u0424\u0430\u0439\u043B \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439 (\u0434\u043E 5 \u041C\u0411).");
      return;
    }
    const bytes = await notify().download(file.id);
    const info = await orders.labelInfo(bytes);
    const dup = await orders.labelDup(info, o.id);
    if (dup) {
      await reply(`\u26A0\uFE0F ${h5(dup.id && (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? orders.dupText(dup) : "\u0422\u0430\u043A\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u043D\u0435 \u0432 \u0456\u043D\u0448\u043E\u043C\u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456.")}`);
      return;
    }
    if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' AND hash = ?`, [o.id, info.hash])) {
      await reply(`\u0426\u0435 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0432\u0436\u0435 \u0434\u043E\u0434\u0430\u043D\u043E \u0434\u043E ${orderNo(o.id)}.`);
      return;
    }
    const replaced = !!await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' LIMIT 1`, [o.id]);
    const who = { name: `${[msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "\u043F\u0430\u0440\u0442\u043D\u0435\u0440"} (Telegram)` };
    const f = await orders.storeFile(o, "label", { bytes, name: file.name, mime: file.mime, hash: info.hash, ttn: info.ttn }, who, " \u0447\u0435\u0440\u0435\u0437 \u0433\u0440\u0443\u043F\u0443 Telegram");
    const r = await afterLabel(o, f, who, { fileId: file.id, replaced });
    await reply(`\u2705 \u041C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u0434\u043E\u0434\u0430\u043D\u043E \u0434\u043E <b>${orderNo(o.id)}</b> (${h5(o.client_name)})${r.ttn && !o.ttn ? `
\u0422\u0422\u041D ${r.ttn} \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.` : ""}${r.warnings.length ? `
\u26A0\uFE0F ${h5(r.warnings.join("; "))}` : ""}`);
  }
  const fileOf = (msg) => {
    if (msg.document) return { id: msg.document.file_id, uid: msg.document.file_unique_id, name: msg.document.file_name || "document", mime: msg.document.mime_type || "application/octet-stream", size: msg.document.file_size || 0 };
    const ph = [...msg.photo || []].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    return { id: ph.file_id, uid: ph.file_unique_id, name: `\u0444\u043E\u0442\u043E_${kyivToday()}.jpg`, mime: "image/jpeg", size: ph.file_size || 0, photo: true };
  };
  const docOf = (id) => db.get(`SELECT * FROM b2b_tg_docs WHERE id = ?`, [id]);
  const saveDoc = (d, fields) => db.run(`UPDATE b2b_tg_docs SET ${Object.keys(fields).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...Object.values(fields), d.id]);
  const parsedOf = (d) => {
    try {
      return JSON.parse(d.parsed || "null");
    } catch {
      return null;
    }
  };
  async function candidates() {
    const since = new Date(Date.now() - 120 * 864e5).toISOString();
    const rows = await db.all(
      `SELECT o.id, o.kind, o.status, o.partner_id, o.total, o.entity, o.invoice_no, o.waybill_no, o.client_name, o.created_at, p.name AS partner
       FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
       WHERE o.status NOT IN ('cancelled', 'open', 'draft') AND o.created_at > ? AND (o.kind = 'supply' OR o.supply_id IS NULL) ORDER BY o.id DESC LIMIT 200`,
      [since]
    );
    const ents = await db.all(`SELECT partner_id, name FROM b2b_entities`);
    const byPartner = /* @__PURE__ */ new Map();
    for (const e of ents) byPartner.set(e.partner_id, [...byPartner.get(e.partner_id) || [], e.name]);
    return rows.map((r) => ({ ...r, names: r.kind === "supply" ? [String(r.entity || "").split("\n")[0].split(",")[0]] : byPartner.get(r.partner_id) || [] }));
  }
  const needs = (o, kind) => kind === "waybill" ? !o.waybill_no : !o.invoice_no;
  function score(o, doc, kind) {
    let s = 0;
    if (doc?.total != null && Math.abs(doc.total - o.total) < 0.01) s += 100;
    if (doc?.buyer && o.names.some((n) => sameName(n, doc.buyer))) s += 50;
    if (kind && needs(o, kind)) s += 20;
    if (kind === "waybill" && o.invoice_no) s += 5;
    return s;
  }
  async function ranked(doc, kind) {
    const list = await candidates();
    return list.map((o) => ({ o, s: score(o, doc, kind) })).sort((a, b) => b.s - a.s || b.o.id - a.o.id).map((x) => x.o);
  }
  async function autoPick(doc, kind) {
    if (!doc) return null;
    const list = await candidates();
    const best = list.filter((o) => score(o, doc, kind) >= 150);
    if (best.length === 1) return best[0].id;
    const needy = best.filter((o) => needs(o, kind));
    return needy.length === 1 ? needy[0].id : null;
  }
  function compareItems(docItems, orderItems) {
    const left = orderItems.map((i) => ({ ...i, tokens: modelTokens(i.name), used: false }));
    const lines = [];
    let bad = 0;
    for (const d of docItems) {
      let hit = left.find((i) => !i.used && Math.abs(i.price - d.price) < 0.01 && i.qty === d.qty);
      if (!hit) {
        const dt = modelTokens(d.name);
        let best = null;
        let bestN = 0;
        for (const i of left) {
          if (i.used) continue;
          const n = [...dt].filter((t) => i.tokens.has(t)).length;
          if (n > bestN) {
            best = i;
            bestN = n;
          }
        }
        hit = bestN >= 1 ? best : null;
      }
      const short = h5(d.name.length > 60 ? `${d.name.slice(0, 58)}\u2026` : d.name);
      if (!hit) {
        bad++;
        lines.push(`\u274C ${short} \u2014 ${d.qty} \u0448\u0442 \xD7 ${m22(d.price)} \u2014 <b>\u043D\u0435\u043C\u0430\u0454 \u0432 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456</b>`);
        continue;
      }
      hit.used = true;
      if (hit.qty === d.qty && Math.abs(hit.price - d.price) < 0.01) lines.push(`\u2705 ${short} \u2014 ${d.qty} \u0448\u0442 \xD7 ${m22(d.price)}`);
      else {
        bad++;
        lines.push(`\u26A0\uFE0F ${short} \u2014 \u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456 <b>${d.qty} \u0448\u0442 \xD7 ${m22(d.price)}</b>, \u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 <b>${hit.qty} \u0448\u0442 \xD7 ${m22(hit.price)}</b>`);
      }
    }
    for (const i of left.filter((x) => !x.used)) {
      bad++;
      lines.push(`\u274C ${h5(i.name.slice(0, 60))} \u2014 ${i.qty} \u0448\u0442 \xD7 ${m22(i.price)} \u2014 <b>\u043D\u0435\u043C\u0430\u0454 \u0432 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456</b>`);
    }
    return { lines, bad };
  }
  const kbd = (rows) => ({ inline_keyboard: rows.filter((r) => r.length) });
  const btn = (text, d, act, arg = "") => ({ text, callback_data: `bd:${d.id}:${act}${arg !== "" ? `:${arg}` : ""}` });
  async function render(d, { page = 0 } = {}) {
    const doc = parsedOf(d);
    const kind = d.kind;
    const head = `${kind ? `${kind === "invoice" ? "\u{1F9FE}" : "\u{1F4E6}"} <b>${KIND_NAME[kind]}</b>` : "\u{1F4C4} <b>\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442</b>"}${d.number ? ` \u2116 <b>${h5(d.number)}</b>` : ""}${d.doc_date ? ` \u0432\u0456\u0434 ${fmtDate(d.doc_date)}` : ""}${doc?.total != null ? ` \xB7 <b>${m22(doc.total)} \u0433\u0440\u043D</b>` : ""}${doc?.buyer ? `
\u041F\u043E\u043A\u0443\u043F\u0435\u0446\u044C: ${h5(doc.buyer)}` : ""}
<i>${h5(d.name)}</i>${doc ? "" : d.mime === "application/pdf" ? "\n<i>\u0422\u0435\u043A\u0441\u0442 \u0443 PDF \u043D\u0435 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E \u2014 \u2116 \u0432\u0432\u0435\u0434\u0456\u0442\u044C \u0432\u0440\u0443\u0447\u043D\u0443.</i>" : ""}`;
    if (!d.order_id) {
      let list = await ranked(doc, kind);
      const only = (() => {
        try {
          return JSON.parse(d.choices || "[]");
        } catch {
          return [];
        }
      })();
      if (d.source === "fin" && only.length) list = list.filter((o2) => only.includes(o2.id));
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      const rows2 = slice.map((o2) => [btn(`${o2.kind === "client" ? "\u{1F534} " : ""}${orderNo(o2.id)} \xB7 ${o2.partner} \xB7 ${m22(o2.total)} \u20B4${score(o2, doc, kind) >= 150 ? " \u2705" : ""}${needs(o2, kind || "invoice") ? kind === "waybill" ? " \xB7 \u0431\u0435\u0437 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u043E\u0457" : " \xB7 \u0431\u0435\u0437 \u0440\u0430\u0445\u0443\u043D\u043A\u0443" : ""}`.slice(0, 64), d, "o", o2.id)]);
      const nav = [];
      if (page > 0) nav.push(btn("\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434", d, "pg", page - 1));
      if (list.length > (page + 1) * PAGE) nav.push(btn("\u0429\u0435 \u25B6\uFE0F", d, "pg", page + 1));
      return {
        text: `${head}

<b>\u0414\u043E \u044F\u043A\u043E\u0433\u043E \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043F\u0440\u0438\u043A\u0440\u0456\u043F\u0438\u0442\u0438?</b>${list.length ? "\n\u2705 \u2014 \u0437\u0431\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F \u0441\u0443\u043C\u0430 \u0456 \u043F\u043E\u043A\u0443\u043F\u0435\u0446\u044C \xB7 \u{1F534} \u2014 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456" : "\n\u041D\u0435\u043C\u0430\u0454 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0438\u0445 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u0435\u043B\u044C."}`,
        keyboard: kbd([...rows2, nav, [btn(d.source === "fin" ? "\u041D\u0435 \u0442\u043E\u0439 \u0444\u0430\u0439\u043B" : "\u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438", d, "cancel")]]),
        bad: 1
      };
    }
    const o = await db.get(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE o.id = ?`, [d.order_id]);
    if (!o || o.status === "cancelled") {
      await saveDoc(d, { order_id: null });
      return render({ ...d, order_id: null });
    }
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const names = o.kind === "supply" ? [String(o.entity || "").split("\n")[0].split(",")[0]] : (await db.all(`SELECT name FROM b2b_entities WHERE partner_id = ?`, [o.partner_id])).map((x) => x.name);
    const checks = [];
    let bad = 0;
    if (doc?.buyer) {
      const ok = names.some((n) => sameName(n, doc.buyer));
      bad += ok ? 0 : 1;
      checks.push(ok ? "\u2705 \u041F\u043E\u043A\u0443\u043F\u0435\u0446\u044C \u0437\u0431\u0456\u0433\u0430\u0454\u0442\u044C\u0441\u044F" : `\u26A0\uFE0F \u041F\u043E\u043A\u0443\u043F\u0435\u0446\u044C \u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456 \u043D\u0435 \u0437\u0431\u0456\u0433\u0430\u0454\u0442\u044C\u0441\u044F \u0437 \u044E\u0440\u043E\u0441\u043E\u0431\u043E\u044E (${h5(names[0] || "\u2014")})`);
    }
    if (doc?.total != null) {
      const ok = Math.abs(doc.total - o.total) < 0.01;
      bad += ok ? 0 : 1;
      checks.push(ok ? "\u2705 \u0421\u0443\u043C\u0430 \u0437\u0431\u0456\u0433\u0430\u0454\u0442\u044C\u0441\u044F" : `\u26A0\uFE0F \u0421\u0443\u043C\u0430: \u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456 <b>${m22(doc.total)}</b>, \u0443 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 <b>${m22(o.total)}</b>`);
    }
    let itemLines = [];
    if (doc?.items?.length) {
      const r = compareItems(doc.items, items);
      bad += r.bad;
      itemLines = r.lines;
    }
    if (kind === "invoice" && o.invoice_no && o.invoice_no !== d.number) checks.push(`\u26A0\uFE0F \u0423 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 \u0432\u0436\u0435 \u0454 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.invoice_no)} \u2014 \u0431\u0443\u0434\u0435 \u0437\u0430\u043C\u0456\u043D\u0435\u043D\u043E`);
    if (kind === "waybill" && o.waybill_no && o.waybill_no !== d.number) checks.push(`\u26A0\uFE0F \u0423 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u0456 \u0432\u0436\u0435 \u0454 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 \u2116 ${h5(o.waybill_no)} \u2014 \u0431\u0443\u0434\u0435 \u0437\u0430\u043C\u0456\u043D\u0435\u043D\u043E`);
    if (d.number && kind) {
      const dup = await db.get(`SELECT id FROM b2b_orders WHERE id != ? AND ${kind === "invoice" ? "invoice_no" : "waybill_no"} = ? AND status != 'cancelled' LIMIT 1`, [o.id, d.number]);
      if (dup) {
        bad++;
        checks.push(`\u26A0\uFE0F ${KIND_NAME[kind]} \u2116 ${h5(d.number)} \u0443\u0436\u0435 \u0454 \u0432 ${orderNo(dup.id)}`);
      }
    }
    const target = `\u2192 <b>${orderNo(o.id)}</b> \xB7 ${h5(o.partner)}${o.kind === "client" ? ` \xB7 \u043A\u043B\u0456\u0454\u043D\u0442 ${h5(o.client_name)} \xB7 \u{1F534} <b>\u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456</b>` : ` \xB7 ${h5(names[0] || "")}`} \xB7 ${m22(o.total)} \u20B4`;
    const more = itemLines.length > 20 ? [`\u2026\u0449\u0435 ${itemLines.length - 20}`] : [];
    const text = `${head}

${target}
${[...checks, ...itemLines.slice(0, 20), ...more].join("\n")}${!kind ? "\n\n<b>\u0429\u043E \u0446\u0435 \u0437\u0430 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442?</b>" : ""}${kind === "invoice" && !d.number ? "\n\n\u26A0\uFE0F \u041D\u0435\u043C\u0430\u0454 \u2116 \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u2014 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0412\u043A\u0430\u0437\u0430\u0442\u0438 \u2116\xBB." : ""}`;
    const rows = [];
    if (d.source === "fin") {
      rows.push([btn(bad ? `\u26A0\uFE0F \u041F\u0440\u0438\u043A\u0440\u0456\u043F\u0438\u0442\u0438 \u0432\u0441\u0435 \u043E\u0434\u043D\u043E \u0434\u043E ${orderNo(o.id)}` : `\u2705 \u041F\u0440\u0438\u043A\u0440\u0456\u043F\u0438\u0442\u0438 \u0434\u043E ${orderNo(o.id)}`, d, "save")]);
      rows.push([btn("\u0406\u043D\u0448\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F", d, "other"), btn("\u041D\u0435 \u0442\u043E\u0439 \u0444\u0430\u0439\u043B", d, "cancel")]);
      return { text, keyboard: kbd(rows), bad };
    }
    if (!kind) rows.push([btn("\u{1F9FE} \u0420\u0430\u0445\u0443\u043D\u043E\u043A", d, "k", "invoice"), btn("\u{1F4E6} \u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430", d, "k", "waybill")]);
    else rows.push([btn(bad ? "\u26A0\uFE0F \u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432\u0441\u0435 \u043E\u0434\u043D\u043E" : "\u2705 \u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438", d, "save")]);
    rows.push([btn(d.number ? "\u0417\u043C\u0456\u043D\u0438\u0442\u0438 \u2116" : "\u0412\u043A\u0430\u0437\u0430\u0442\u0438 \u2116", d, "num"), ...kind ? [btn(kind === "invoice" ? "\u0426\u0435 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430" : "\u0426\u0435 \u0440\u0430\u0445\u0443\u043D\u043E\u043A", d, "k", kind === "invoice" ? "waybill" : "invoice")] : []]);
    rows.push([btn("\u0406\u043D\u0448\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F", d, "other"), btn("\u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438", d, "cancel")]);
    return { text, keyboard: kbd(rows), bad };
  }
  async function show(d, { page = 0, fresh = false } = {}) {
    const r = await render(d, { page });
    if (d.msg_id && !fresh) {
      await tgApi("editMessageText", { chat_id: d.chat_id, message_id: d.msg_id, text: r.text, parse_mode: "HTML", reply_markup: r.keyboard, disable_web_page_preview: true }).catch(() => 0);
    } else {
      const m = await tgApi("sendMessage", {
        chat_id: d.chat_id,
        text: r.text,
        parse_mode: "HTML",
        reply_markup: r.keyboard,
        disable_web_page_preview: true,
        ...d.reply_to ? { reply_to_message_id: d.reply_to, allow_sending_without_reply: true } : {}
      });
      await saveDoc(d, { msg_id: m?.message_id || 0 });
    }
  }
  async function tgPrivate(msg, user, base) {
    if (!can(user, "b2b.admin")) return false;
    const chat = String(msg.chat.id);
    if (msg.text && !msg.text.startsWith("/")) {
      const d = await db.get(`SELECT * FROM b2b_tg_docs WHERE chat_id = ? AND state = 'await_number' ORDER BY id DESC LIMIT 1`, [chat]);
      if (!d) return false;
      const num4 = String(msg.text).trim().replace(/^№\s*/, "").slice(0, 40);
      await saveDoc(d, { number: num4, state: "pending" });
      await show({ ...await docOf(d.id) }, { fresh: true });
      return true;
    }
    if (!msg.document && !msg.photo) return false;
    const file = fileOf(msg);
    if (file.size > MAX_FILE2) {
      await tgApi("sendMessage", { chat_id: chat, text: "\u0424\u0430\u0439\u043B \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439: \u043D\u0430 \u0441\u0430\u0439\u0442\u0456 \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F \u0444\u0430\u0439\u043B\u0438 \u0434\u043E 5 \u041C\u0411. \u0421\u0442\u0438\u0441\u043D\u0456\u0442\u044C PDF \u0430\u0431\u043E \u043D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u043C\u0435\u043D\u0448\u0438\u0439 \u0444\u0430\u0439\u043B." }).catch(() => 0);
      return true;
    }
    const bytes = await notify().download(file.id);
    const doc = isPdf(bytes) ? parseBasDoc(await pdfText(bytes)) : null;
    const hints = hintsOf(`${msg.caption || ""} ${file.name}`);
    const replyId = Number(/B2B-(\d+)/.exec(String(msg.reply_to_message?.text || msg.reply_to_message?.caption || ""))?.[1]) || null;
    const kind = doc?.kind || hints.kind || "";
    const orderId = replyId || hints.order || await autoPick(doc, kind);
    const r = await db.run(
      `INSERT INTO b2b_tg_docs (chat_id, user_id, file_id, file_uid, name, mime, size, parsed, order_id, kind, number, doc_date, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        chat,
        user.id,
        file.id,
        file.uid || "",
        file.name,
        file.mime,
        file.size || bytes.length,
        doc ? JSON.stringify(doc) : "",
        orderId,
        kind,
        doc?.number || hints.number || "",
        doc?.date || kyivToday(),
        nowIso()
      ]
    );
    await show(await docOf(r.lastId), { fresh: true });
    return true;
  }
  async function isChatAdmin(chat, tgUserId) {
    const r = await tgApi("getChatMember", { chat_id: chat, user_id: tgUserId }).catch(() => null);
    return ["creator", "administrator"].includes(r?.status);
  }
  const tgWho = (from) => ({ name: `${[from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || "Telegram"} (Telegram)` });
  async function tgCallback(cq, user, base) {
    const m = /^bd:(\d+):(\w+)(?::(.+))?$/.exec(String(cq.data || ""));
    if (!m) return "";
    const d = await docOf(Number(m[1]));
    if (!d || d.chat_id !== String(cq.message?.chat?.id)) return "\u0417\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0430 \u043A\u043D\u043E\u043F\u043A\u0430.";
    const siteAdmin = !!user && can(user, "b2b.admin");
    if (d.source === "fin" ? !(siteAdmin || await isChatAdmin(d.chat_id, cq.from?.id)) : !siteAdmin) return "\u041B\u0438\u0448\u0435 \u0434\u043B\u044F \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0456\u0432.";
    user = siteAdmin ? user : null;
    d.who = siteAdmin ? null : tgWho(cq.from);
    const act = m[2];
    const arg = m[3];
    if (d.state === "cancelled") return "\u0423\u0436\u0435 \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.";
    if (act === "undo") return undo(d, user, base);
    if (d.state === "saved" || d.state === "undone") return "\u0423\u0436\u0435 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E.";
    if (act === "cancel") {
      await saveDoc(d, { state: "cancelled" });
      await tgApi("editMessageText", { chat_id: d.chat_id, message_id: d.msg_id, text: `\u2716\uFE0F \u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u2014 \xAB${h5(d.name)}\xBB \u043D\u0456\u043A\u0443\u0434\u0438 \u043D\u0435 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E.`, parse_mode: "HTML" }).catch(() => 0);
      return "";
    }
    if (act === "pg") {
      await show(d, { page: Number(arg) || 0 });
      return "";
    }
    if (act === "other") {
      await saveDoc(d, { order_id: null });
      await show({ ...d, order_id: null });
      return "";
    }
    if (act === "o") {
      await saveDoc(d, { order_id: Number(arg) });
      await show({ ...d, order_id: Number(arg) });
      return "";
    }
    if (act === "k" && KIND_NAME[arg]) {
      await saveDoc(d, { kind: arg });
      await show({ ...d, kind: arg });
      return "";
    }
    if (act === "num") {
      await saveDoc(d, { state: "await_number" });
      await tgApi("sendMessage", { chat_id: d.chat_id, text: `\u041D\u0430\u043F\u0438\u0448\u0456\u0442\u044C \u2116 ${d.kind === "waybill" ? "\u043D\u0430\u043A\u043B\u0430\u0434\u043D\u043E\u0457" : "\u0440\u0430\u0445\u0443\u043D\u043A\u0443"} \u043E\u0434\u043D\u0438\u043C \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F\u043C (\u043D\u0430\u043F\u0440\u0438\u043A\u043B\u0430\u0434: 125).`, reply_markup: { force_reply: true } }).catch(() => 0);
      return "";
    }
    if (act === "save") return save(d, user, base);
    return "";
  }
  async function save(d, user, base) {
    if (!d.order_id) return "\u0421\u043F\u0435\u0440\u0448\u0443 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.";
    if (!d.kind) return "\u041E\u0431\u0435\u0440\u0456\u0442\u044C: \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0447\u0438 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430.";
    if (d.kind === "invoice" && !d.number) {
      await saveDoc(d, { state: "await_number" });
      await tgApi("sendMessage", { chat_id: d.chat_id, text: "\u041D\u0430\u043F\u0438\u0448\u0456\u0442\u044C \u2116 \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u043E\u0434\u043D\u0438\u043C \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F\u043C \u2014 \u0456 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438\xBB \u0449\u0435 \u0440\u0430\u0437.", reply_markup: { force_reply: true } }).catch(() => 0);
      return "\u041F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u2116 \u0440\u0430\u0445\u0443\u043D\u043A\u0443";
    }
    const o = await orders.orderOf(d.order_id);
    if (o.status === "cancelled") return "\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.";
    const claim = await db.run(`UPDATE b2b_tg_docs SET state = 'saving' WHERE id = ? AND state = 'pending'`, [d.id]);
    if (!claim.changes) return "\u0423\u0436\u0435 \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u0454\u0442\u044C\u0441\u044F\u2026";
    try {
      const bytes = await notify().download(d.file_id);
      const who = user ? { id: user.id, name: user.name || user.login } : d.who || { name: d.tg_name || "Telegram" };
      const f = await orders.storeFile(o, d.kind, { bytes, name: d.name, mime: d.mime }, who, d.source === "fin" ? " (\u0433\u0440\u0443\u043F\u0430 \xAB\u0424\u0456\u043D\u0430\u043D\u0441\u043E\u0432\u0456 \u043F\u0438\u0442\u0430\u043D\u043D\u044F\xBB)" : " \u0447\u0435\u0440\u0435\u0437 Telegram");
      const prev = { invoice_no: o.invoice_no, invoice_date: o.invoice_date, waybill_no: o.waybill_no, status: o.status };
      const next = d.kind === "invoice" ? { invoice_no: d.number, invoice_date: d.doc_date || kyivToday() } : d.number ? { waybill_no: d.number } : {};
      await orders.applyNumbers(o, next, who, base, " (\u0447\u0435\u0440\u0435\u0437 Telegram)");
      const r = await render({ ...d, state: "saving" });
      const issues = r.text.split("\n").filter((l) => l.startsWith("\u26A0\uFE0F") || l.startsWith("\u274C")).map((l) => l.replace(/<[^>]+>/g, ""));
      if (issues.length) await orders.log(o.id, who, `\u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E \u0437 \u0440\u043E\u0437\u0431\u0456\u0436\u043D\u043E\u0441\u0442\u044F\u043C\u0438: ${issues.join("; ").slice(0, 900)}`);
      let group = null;
      const g = await orders.groupOf(o.partner_id);
      if (g) {
        const cap = `${d.kind === "invoice" ? "\u{1F9FE} \u0420\u0430\u0445\u0443\u043D\u043E\u043A" : "\u{1F4E6} \u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430"}${d.number ? ` \u2116 ${h5(d.number)}` : ""} \u2014 ${o.kind === "client" ? "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F" : "\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F"} <b>${orderNo(o.id)}</b> \u043D\u0430 ${m22(o.total)} \u0433\u0440\u043D`;
        if (await notify().sendFile({ chatIds: [g] }, { fileId: d.file_id }, cap).catch(() => 0)) group = notify().lastFileMessage?.() || null;
      }
      await saveDoc(d, { state: "saved", saved_at: nowIso(), file_row: f.id, prev: JSON.stringify(prev), group_msg: group ? JSON.stringify(group) : "" });
      if (d.source === "fin" && d.kind === "invoice" && d.reply_to) await db.run(`UPDATE b2b_orders SET fin_inv_msg = ? WHERE id = ?`, [d.reply_to, o.id]);
      if (d.source === "fin") {
        if (d.reply_to) await tgApi("setMessageReaction", { chat_id: d.chat_id, message_id: d.reply_to, reaction: [{ type: "emoji", emoji: "\u{1F44C}" }] }).catch(() => 0);
        if (d.msg_id) await tgApi("deleteMessage", { chat_id: d.chat_id, message_id: d.msg_id }).catch(() => 0);
        return "\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E";
      }
      const url = `${base}/#/${o.kind === "client" ? "b2bclients" : "b2borders"}/${o.id}`;
      const done = {
        chat_id: d.chat_id,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: `\u2705 <b>\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E:</b> ${KIND_NAME[d.kind]}${d.number ? ` \u2116 ${h5(d.number)}` : ""} \u2192 <b>${orderNo(o.id)}</b> (${h5(o.client_name || o.entity.split("\n")[0].split(",")[0])}, ${m22(o.total)} \u20B4)${issues.length ? `
\u26A0\uFE0F \u0437 \u0440\u043E\u0437\u0431\u0456\u0436\u043D\u043E\u0441\u0442\u044F\u043C\u0438 (${issues.length}) \u2014 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E \u0432 \u0456\u0441\u0442\u043E\u0440\u0456\u044E` : ""}${group ? "\n\u{1F4E4} \u041D\u0430\u0434\u0456\u0441\u043B\u0430\u043D\u043E \u0432 \u0433\u0440\u0443\u043F\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430" : ""}`,
        reply_markup: kbd([[{ text: "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u043D\u0430 \u0441\u0430\u0439\u0442\u0456", url }, btn(`\u21A9\uFE0F \u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438 (${UNDO_MIN} \u0445\u0432)`, d, "undo")]])
      };
      if (d.msg_id) await tgApi("editMessageText", { ...done, message_id: d.msg_id }).catch(() => 0);
      else {
        const sent = await tgApi("sendMessage", { ...done, ...d.reply_to ? { reply_to_message_id: d.reply_to, allow_sending_without_reply: true } : {} }).catch(() => null);
        if (sent?.message_id) await saveDoc(d, { msg_id: sent.message_id });
      }
      return "\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E";
    } catch (e) {
      await saveDoc(d, { state: "pending" });
      throw e;
    }
  }
  async function undo(d, user, base) {
    if (d.state !== "saved") return "\u041D\u0456\u0447\u043E\u0433\u043E \u0441\u043A\u0430\u0441\u043E\u0432\u0443\u0432\u0430\u0442\u0438.";
    if (Date.now() - Date.parse(d.saved_at) > UNDO_MIN * 6e4) return `\u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u043C\u043E\u0436\u043D\u0430 \u043B\u0438\u0448\u0435 ${UNDO_MIN} \u0445\u0432 \u2014 \u0437\u043C\u0456\u043D\u0456\u0442\u044C \u043D\u0430 \u0441\u0430\u0439\u0442\u0456.`;
    const prev = JSON.parse(d.prev || "{}");
    const o = await orders.orderOf(d.order_id).catch(() => null);
    if (o) {
      await orders.deleteFile(d.file_row);
      await db.run(
        `UPDATE b2b_orders SET invoice_no = ?, invoice_date = ?, waybill_no = ?, status = ?, updated_at = ? WHERE id = ?`,
        [prev.invoice_no ?? o.invoice_no, prev.invoice_date ?? o.invoice_date, prev.waybill_no ?? o.waybill_no, prev.status ?? o.status, nowIso(), o.id]
      );
      await orders.log(o.id, user ? { name: user.name || user.login } : d.who || { name: "Telegram" }, `\u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E \u0447\u0435\u0440\u0435\u0437 Telegram: ${KIND_NAME[d.kind]}${d.number ? ` \u2116 ${d.number}` : ""}`);
      if (d.source === "fin" && d.kind === "invoice") await db.run(`UPDATE b2b_orders SET fin_inv_msg = NULL WHERE id = ? AND fin_inv_msg = ?`, [o.id, d.reply_to]);
      if (d.kind === "invoice" && d.number && d.number !== prev.invoice_no) {
        await orders.tgPartner(o.partner_id, `\u21A9\uFE0F \u0420\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(d.number)} \u0434\u043E ${orderNo(o.id)} \u0432\u0456\u0434\u043A\u043B\u0438\u043A\u0430\u043D\u043E \u2014 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u043D\u0430\u0434\u0456\u0448\u043B\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439.`);
      }
    }
    const g = d.group_msg ? JSON.parse(d.group_msg) : null;
    if (g?.id) await tgApi("deleteMessage", { chat_id: g.chat, message_id: g.id }).catch(() => 0);
    await saveDoc(d, { state: "undone" });
    await tgApi("editMessageText", { chat_id: d.chat_id, message_id: d.msg_id, text: `\u21A9\uFE0F \u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E: ${KIND_NAME[d.kind]}${d.number ? ` \u2116 ${h5(d.number)}` : ""} \u043F\u0440\u0438\u0431\u0440\u0430\u043D\u043E \u0437 ${orderNo(d.order_id)}.`, parse_mode: "HTML" }).catch(() => 0);
    return "\u0421\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E";
  }
  const FIN_SET = ["b2b_fin_chat", "b2b_fin_title", "b2b_fin_code"];
  app.get("/api/b2b/fin-group", async (c) => {
    need(c, "b2b.admin");
    const s = await loadSettings(db);
    return c.json({ chat: s.b2b_fin_chat || "", title: s.b2b_fin_title || "", bot: s.tg_bot || "" });
  });
  app.post("/api/b2b/fin-group", async (c) => {
    need(c, "b2b.admin");
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, "Telegram-\u0431\u043E\u0442\u0430 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E (\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u2192 Telegram).");
    const code = randomToken(6);
    await set("b2b_fin_code", `${code}|${Date.now() + 30 * 6e4}`);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete("/api/b2b/fin-group", async (c) => {
    need(c, "b2b.admin");
    await db.batch([[`DELETE FROM settings WHERE key IN (${FIN_SET.map(() => "?").join(", ")})`, FIN_SET]]);
    return c.json({ ok: true });
  });
  async function linkFinGroup(code, chat, title) {
    const s = await loadSettings(db);
    const [want, exp] = String(s.b2b_fin_code || "").split("|");
    if (!want || want !== code || (Number(exp) || 0) < Date.now()) return "";
    await set("b2b_fin_chat", chat);
    await set("b2b_fin_title", String(title).slice(0, 120));
    await db.run(`DELETE FROM settings WHERE key = 'b2b_fin_code'`);
    return "\u2705 \u0413\u0440\u0443\u043F\u0443 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E \u044F\u043A <b>\xAB\u0424\u0456\u043D\u0430\u043D\u0441\u043E\u0432\u0456 \u043F\u0438\u0442\u0430\u043D\u043D\u044F\xBB</b>: \u0441\u044E\u0434\u0438 \u0431\u043E\u0442 \u043F\u0438\u0441\u0430\u0442\u0438\u043C\u0435 \u0437\u0430\u043F\u0438\u0442\u0438 \u0440\u0430\u0445\u0443\u043D\u043A\u0456\u0432 \u0456 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0438\u0445 \u043D\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 B2B. \u041D\u0430\u0434\u0441\u0438\u043B\u0430\u0439\u0442\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 <b>\u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0434\u044E \u043D\u0430 \u0437\u0430\u043F\u0438\u0442</b>. \u0429\u043E\u0431 \u0431\u043E\u0442 \u0431\u0430\u0447\u0438\u0432 \u0456 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0438 \u0431\u0435\u0437 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456 \u2014 \u0437\u0440\u043E\u0431\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u043E\u043C \u0433\u0440\u0443\u043F\u0438.";
  }
  const finChat = async () => (await db.get(`SELECT value FROM settings WHERE key = 'b2b_fin_chat'`))?.value || "";
  const orderFull = (id) => db.get(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE o.id = ?`, [id]);
  const firstLine2 = (e) => String(e || "").split("\n")[0];
  async function reqText(o, { mode = "", done = false } = {}) {
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const lines = items.slice(0, 50).map((i) => `${h5(i.name)} \u2014 ${i.qty} \u0448\u0442 \u2014 ${m22(i.price)}`);
    if (items.length > 50) lines.push(`\u2026\u0456 \u0449\u0435 ${items.length - 50} \u043F\u043E\u0437.`);
    const head = done ? `\u{1F9FE} <b>\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)}</b> \xB7 \u2705 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.invoice_no)} \u0434\u043E\u0434\u0430\u043D\u043E` : o.reinvoice ? `\u{1F501} <b>\u041F\u0435\u0440\u0435\u0440\u043E\u0431\u0456\u0442\u044C \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.reinvoice)} \xB7 ${orderNo(o.id)}</b>
\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 \u0446\u0435\u0439 \u0441\u043A\u043B\u0430\u0434${Number(o.paid_amount) > 0 ? ` (\u0443\u0436\u0435 \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E ${m22(o.paid_amount)} \u0433\u0440\u043D)` : ""}` : `\u{1F9FE} <b>\u041F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0440\u0430\u0445\u0443\u043D\u043E\u043A \xB7 ${orderNo(o.id)}</b>${mode === "changed" ? " <i>(\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u043C\u0456\u043D\u0435\u043D\u043E)</i>" : ""}`;
    return `${head}
\u041F\u0430\u0440\u0442\u043D\u0435\u0440: \xAB${h5(o.partner)}\xBB

<b>\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430:</b>
${h5(o.entity)}
${o.delivery === "pickup" ? "\u{1F697} <b>\u0421\u0430\u043C\u043E\u0432\u0438\u0432\u0456\u0437</b> \u2014 \u043F\u0430\u0440\u0442\u043D\u0435\u0440 \u0437\u0430\u0431\u0438\u0440\u0430\u0454 \u0432\u0441\u044E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u0456 \u0441\u043A\u043B\u0430\u0434\u0443\n" : ""}
<b>\u0422\u043E\u0432\u0430\u0440\u0438:</b>
${lines.join("\n")}

<b>\u0420\u0430\u0437\u043E\u043C: ${m22(o.total)} \u0433\u0440\u043D</b> (\u0437 \u041F\u0414\u0412)${o.comment ? `
<i>\u041A\u043E\u043C\u0435\u043D\u0442\u0430\u0440: ${h5(String(o.comment).slice(0, 200))}</i>` : ""}${done ? "" : "\n\n\u21A9\uFE0F \u041D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u0440\u0430\u0445\u0443\u043D\u043E\u043A <b>\u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0434\u044E \u043D\u0430 \u0446\u0435 \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F</b>"}`;
  }
  async function finRequest(orderId, mode = "") {
    const chat = await finChat();
    if (!chat) return;
    const o = await orderFull(orderId);
    if (!o || o.kind !== "supply" || o.status !== "invoice_wait") return;
    const text = await reqText(o, { mode });
    if (mode === "reinvoice") {
      const reply = o.fin_inv_msg || o.fin_req_msg;
      const m3 = await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", ...reply ? { reply_to_message_id: reply, allow_sending_without_reply: true } : {} }).catch(() => null);
      if (m3?.message_id) await db.run(`UPDATE b2b_orders SET fin_req_msg = ?, fin_inv_msg = NULL, fin_pay_msg = NULL, fin_done = 0 WHERE id = ?`, [m3.message_id, o.id]);
      return;
    }
    if (o.fin_req_msg) {
      const ok = await tgApi("editMessageText", { chat_id: chat, message_id: o.fin_req_msg, text, parse_mode: "HTML" }).catch(() => null);
      if (ok) {
        await tgApi("sendMessage", { chat_id: chat, text: `\u270F\uFE0F \u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)} \u0437\u043C\u0456\u043D\u0435\u043D\u043E \u2014 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430 \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0439 \u0441\u043F\u0438\u0441\u043E\u043A.`, reply_to_message_id: o.fin_req_msg, allow_sending_without_reply: true }).catch(() => 0);
        return;
      }
    }
    const m = await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML" }).catch(() => null);
    if (m?.message_id) await db.run(`UPDATE b2b_orders SET fin_req_msg = ? WHERE id = ?`, [m.message_id, o.id]);
  }
  async function finClosed(orderId, note, snap = null) {
    const chat = await finChat();
    const o = snap || await orderFull(orderId);
    if (!chat || !o?.fin_req_msg) return;
    await tgApi("editMessageText", {
      chat_id: chat,
      message_id: o.fin_req_msg,
      parse_mode: "HTML",
      text: `<s>\u{1F9FE} \u041F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0440\u0430\u0445\u0443\u043D\u043E\u043A \xB7 ${orderNo(o.id)}</s> \u2014 <b>${h5(note)}</b>
${h5(firstLine2(o.entity))} \xB7 ${m22(o.total)} \u0433\u0440\u043D`
    }).catch(() => 0);
  }
  async function finNumbers(orderId) {
    const chat = await finChat();
    const o = await orderFull(orderId);
    if (!chat || !o) return;
    if (o.fin_req_msg && o.invoice_no) {
      await tgApi("editMessageText", { chat_id: chat, message_id: o.fin_req_msg, parse_mode: "HTML", text: await reqText(o, { done: true }) }).catch(() => 0);
    }
    if (o.fin_pay_msg && o.waybill_no) {
      if (await tgApi("deleteMessage", { chat_id: chat, message_id: o.fin_pay_msg }).catch(() => null)) await db.run(`UPDATE b2b_orders SET fin_pay_msg = NULL WHERE id = ?`, [o.id]);
      else {
        await tgApi("editMessageText", {
          chat_id: chat,
          message_id: o.fin_pay_msg,
          parse_mode: "HTML",
          text: `\u2705 <b>\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 \u2116 ${h5(o.waybill_no)} \xB7 ${orderNo(o.id)}</b> \u2014 \u0434\u043E\u0434\u0430\u043D\u043E (\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.invoice_no)}, ${m22(o.total)} \u0433\u0440\u043D)`
        }).catch(() => 0);
      }
    }
    if (o.kind === "supply" && o.invoice_no && o.waybill_no && !o.fin_done) {
      const claim = await db.run(`UPDATE b2b_orders SET fin_done = 1 WHERE id = ? AND COALESCE(fin_done, 0) = 0`, [o.id]);
      if (claim.changes) {
        await tgApi("sendMessage", {
          chat_id: chat,
          parse_mode: "HTML",
          text: `\u2705 <b>\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)} \u0437\u0430\u043A\u0440\u0438\u0442\u043E</b> \u2014 \xAB${h5(o.partner)}\xBB
${h5(firstLine2(o.entity))}
\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.invoice_no)} \xB7 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 \u2116 ${h5(o.waybill_no)} \xB7 ${m22(o.total)} \u0433\u0440\u043D`
        }).catch(() => 0);
      }
    }
  }
  async function finPaid(orderId) {
    const chat = await finChat();
    const o = await orderFull(orderId);
    if (!chat || !o || o.waybill_no) return;
    const reply = o.fin_inv_msg || o.fin_req_msg;
    const m = await tgApi("sendMessage", {
      chat_id: chat,
      parse_mode: "HTML",
      ...reply ? { reply_to_message_id: reply, allow_sending_without_reply: true } : {},
      text: `\u{1F4B0} <b>${orderNo(o.id)} \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E</b> (\u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h5(o.invoice_no)}, ${m22(o.total)} \u0433\u0440\u043D, \xAB${h5(o.partner)}\xBB)
\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u0430 <b>\u0432\u0438\u0434\u0430\u0442\u043A\u043E\u0432\u0430 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430</b> \u043D\u0430: ${h5(firstLine2(o.entity))}

\u21A9\uFE0F \u041D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0443 <b>\u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0434\u044E \u043D\u0430 \u0446\u0435 \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F</b>`
    }).catch(() => null);
    if (m?.message_id) await db.run(`UPDATE b2b_orders SET fin_pay_msg = ? WHERE id = ?`, [m.message_id, o.id]);
  }
  async function exactMatch(doc, o) {
    if (!doc || o.kind !== "supply") return false;
    if (Math.abs((doc.total ?? -1) - o.total) >= 0.01) return false;
    if (!doc.buyer || !sameName(firstLine2(o.entity).split(",")[0], doc.buyer)) return false;
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ?`, [o.id]);
    if (!doc.items?.length || compareItems(doc.items, items).bad) return false;
    const dup = await db.get(`SELECT id FROM b2b_orders WHERE id != ? AND ${doc.kind === "invoice" ? "invoice_no" : "waybill_no"} = ? AND status != 'cancelled' LIMIT 1`, [o.id, doc.number]);
    return !dup;
  }
  async function tgFinFile(msg, base) {
    const chat = String(msg.chat.id);
    const d0 = msg.document;
    if (!d0 || !(/pdf/i.test(d0.mime_type || "") || /\.pdf$/i.test(d0.file_name || ""))) return;
    const s = await loadSettings(db);
    const rm = msg.reply_to_message;
    const replyId = rm?.from?.is_bot && rm.from.username === s.tg_bot ? Number(/B2B-(\d+)/.exec(String(rm.text || rm.caption || ""))?.[1]) || null : null;
    const replyTo = msg.message_id;
    const say = (text) => tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_to_message_id: replyTo, allow_sending_without_reply: true }).catch(() => 0);
    if ((d0.file_size || 0) > (replyId ? MAX_FILE2 : 1024 * 1024)) {
      if (replyId) await say("\u0424\u0430\u0439\u043B \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439 (\u0434\u043E 5 \u041C\u0411).");
      return;
    }
    const bytes = await notify().download(d0.file_id);
    const doc = parseBasDoc(await pdfText(bytes));
    if (!doc) {
      if (replyId) await say("\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u0438 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0447\u0438 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0443 \u0437 \u0446\u044C\u043E\u0433\u043E PDF. \u041D\u0430\u0434\u0456\u0448\u043B\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u043E\u0441\u043E\u0431\u0438\u0441\u0442\u043E \u0431\u043E\u0442\u0443 \u0430\u0431\u043E \u0434\u043E\u0434\u0430\u0439\u0442\u0435 \u043D\u0430 \u0441\u0430\u0439\u0442\u0456.");
      return;
    }
    let orderId = replyId;
    let choices = [];
    if (!replyId) {
      const list = (await candidates()).filter((o) => o.kind === "supply" && needs(o, doc.kind) && (doc.kind !== "waybill" || o.invoice_no) && score(o, doc, doc.kind) >= 150);
      for (const o of list) if (await exactMatch(doc, o)) choices.push(o.id);
      if (!choices.length) return;
      if (choices.length === 1) orderId = choices[0];
    }
    const r = await db.run(
      `INSERT INTO b2b_tg_docs (chat_id, user_id, file_id, file_uid, name, mime, size, parsed, order_id, kind, number, doc_date, state, created_at, source, reply_to, tg_name, choices)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'fin', ?, ?, ?)`,
      [
        chat,
        d0.file_id,
        d0.file_unique_id || "",
        d0.file_name || "document.pdf",
        "application/pdf",
        d0.file_size || bytes.length,
        JSON.stringify(doc),
        orderId,
        doc.kind,
        doc.number,
        doc.date || kyivToday(),
        nowIso(),
        replyTo,
        tgWho(msg.from).name,
        JSON.stringify(choices)
      ]
    );
    const d = await docOf(r.lastId);
    if (replyId) {
      const o = await orderFull(replyId);
      if (o && o.status !== "cancelled" && await exactMatch(doc, o)) {
        d.who = tgWho(msg.from);
        await save(d, null, base);
        return;
      }
    }
    await show(d, { fresh: true });
  }
  async function tgGroupMessage(msg, base) {
    if (String(msg.chat.id) === await finChat()) return tgFinFile(msg, base);
    const s = await loadSettings(db);
    if (msg.reply_to_message?.from?.is_bot && msg.reply_to_message.from.username === s.tg_bot) return tgGroupFile(msg, base);
  }
  hooks.cleanup = () => db.run(`DELETE FROM b2b_tg_docs WHERE created_at < ?`, [new Date(Date.now() - 3 * 864e5).toISOString()]);
  hooks.afterLabel = afterLabel;
  hooks.afterDoc = async (o, f, t) => {
    const chat = await labelsChat();
    if (!chat) return;
    const sent = await notify()?.sendFile({ chatIds: [chat] }, f, `\u{1F4C4} <b>${h5(t.name)}</b> \xB7 ${labelCaption(o).replace(/^🏷 /, "")}`).catch(() => 0);
    if (sent) await orders.log(o.id, { name: "Telegram" }, `\xAB${t.name}\xBB \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u043D\u043E \u0432 \u0433\u0440\u0443\u043F\u0443 \u043C\u0430\u0440\u043A\u0443\u0432\u0430\u043D\u044C`);
  };
  hooks.crmLinked = crmLinked;
  hooks.finRequest = finRequest;
  hooks.finClosed = finClosed;
  hooks.finNumbers = finNumbers;
  hooks.finPaid = finPaid;
  const linkSpecialGroup = async (code, chat, title) => await linkLabelsGroup(code, chat, title) || linkFinGroup(code, chat, title);
  return { tgPrivate, tgCallback, tgGroupMessage, linkSpecialGroup };
}

// src/modules/b2b/odbpay.js
var DUE_EPS = 1;
var userName3 = (u) => u?.name || u?.login || "";
function purposeHasNo(purpose, invoiceNo) {
  const digits = String(invoiceNo || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return false;
  return [...String(purpose || "").matchAll(/\d+/g)].some((m) => m[0].replace(/^0+/, "") === digits);
}
var digitsOf = (v) => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
function purposeNos(purpose) {
  const t = String(purpose || "");
  const out = [...t.matchAll(/№\s*([A-Za-zА-Яа-яІіЇїЄє]{0,4}[-–]?\s?\d[\d\-/]*)/g), ...t.matchAll(/рах(?:ун[а-яіїє]*|\.)?\s*№?\s*(\d+)/gi)].map((m) => digitsOf(m[1].split("/")[0])).filter(Boolean);
  return [...new Set(out)];
}
var foreignInvoice = (purpose, invoiceNo) => {
  const nos = purposeNos(purpose);
  return nos.length > 0 && !nos.includes(digitsOf(invoiceNo));
};
function mountB2bPay(app, { db, services, orders, hooks }) {
  const { log, tgAdmins, tgPartner, link, uah: uah3, h: h6 } = orders;
  const candidatesFor = (codes) => db.all(
    `SELECT o.id, o.partner_id, o.total, o.paid_amount, o.invoice_no, o.status, e.code FROM b2b_orders o JOIN b2b_entities e ON e.id = o.entity_id
     WHERE o.kind = 'supply' AND o.status IN ('pay_wait', 'partial') AND e.code IN (SELECT value FROM json_each(?)) ORDER BY o.id`,
    [JSON.stringify(codes)]
  );
  const due = (o) => round2(o.total - o.paid_amount);
  async function recalc(orderId, base, user = null) {
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ?`, [orderId]);
    if (!o || o.kind !== "supply" || ["cancelled", "done", "open"].includes(o.status)) return;
    if (o.status === "paid" && o.paid_by !== "Opendatabot") return;
    const s = await db.get(`SELECT COALESCE(SUM(amount), 0) AS sum, MAX(date) AS at FROM b2b_payments WHERE order_id = ?`, [o.id]);
    const sum = round2(s.sum);
    const status = sum > 0 && sum >= o.total - DUE_EPS ? "paid" : sum > 0 ? "partial" : o.invoice_no ? "pay_wait" : "invoice_wait";
    await db.run(
      `UPDATE b2b_orders SET paid_amount = ?, paid_at = ?, paid_by = ?, status = ?, updated_at = ? WHERE id = ?`,
      [sum, sum ? s.at : "", sum ? "Opendatabot" : "", status, nowIso(), o.id]
    );
    if (status === o.status && sum === round2(o.paid_amount)) return;
    const who = user ? ` (${userName3(user)})` : " (Opendatabot)";
    const url = (hash2) => base ? `
${link(base, hash2)}` : "";
    if (status === "paid") {
      await log(o.id, user, `\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E: ${uah3(sum)}${user ? "" : " \u2014 Opendatabot"}`);
      await tgPartner(o.partner_id, `\u2705 <b>\u041E\u043F\u043B\u0430\u0442\u0443 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E</b>: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)}${o.invoice_no ? `, \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h6(o.invoice_no)}` : ""} \u2014 ${uah3(o.total)}${url(`porders/${o.id}`)}`);
      await tgAdmins(`\u2705 <b>\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E</b>${who}: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)} \u2014 ${uah3(sum)}${url(`b2borders/${o.id}`)}`);
      if (o.status !== "paid") {
        await hooks.finPaid?.(o.id).catch(() => 0);
        await hooks.crmPaid?.(o.id, typeof base === "string" ? base : base ? new URL(base.req.url).origin : "").catch(() => 0);
      }
    } else if (status === "partial") {
      const left = round2(o.total - sum);
      await log(o.id, user, `\u0447\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E: ${uah3(sum)} \u0437 ${uah3(o.total)}, \u0437\u0430\u043B\u0438\u0448\u043E\u043A ${uah3(left)}`);
      await tgPartner(o.partner_id, `\u{1F4B3} <b>\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u0430 \u043E\u043F\u043B\u0430\u0442\u0430</b>: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)} \u2014 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E ${uah3(sum)} \u0437 ${uah3(o.total)}.
<b>\u0429\u0435 \u0434\u043E \u043E\u043F\u043B\u0430\u0442\u0438: ${uah3(left)}</b>${url(`porders/${o.id}`)}`);
      await tgAdmins(`\u{1F4B3} <b>\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E</b>${who}: \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F ${orderNo(o.id)} \u2014 ${uah3(sum)} \u0437 ${uah3(o.total)}, \u0437\u0430\u043B\u0438\u0448\u043E\u043A ${uah3(left)}${url(`b2borders/${o.id}`)}`);
    } else {
      await log(o.id, user, `\u043E\u043F\u043B\u0430\u0442\u0443 \u0437\u043D\u044F\u0442\u043E: \xAB${status === "pay_wait" ? "\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443" : "\u041E\u0447\u0456\u043A\u0443\u0454 \u0440\u0430\u0445\u0443\u043D\u043E\u043A"}\xBB`);
    }
  }
  async function onPayments(ids, base = "") {
    if (!ids?.length || !services.payments?.txs) return;
    let txs = (await services.payments.txs(ids)).filter((t) => t.currency === "UAH" && t.amount > 0 && t.payer_code);
    if (!txs.length) return;
    const all = await candidatesFor([...new Set(txs.map((t) => t.payer_code))]);
    if (!all.length) return;
    txs = txs.filter((t) => all.some((o) => o.code === t.payer_code)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
    const known = new Set((await db.all(`SELECT tx_id FROM b2b_payments WHERE tx_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(txs.map((t) => t.id))])).map((r) => r.tx_id));
    for (const t of txs) {
      if (known.has(t.id)) continue;
      const cands = all.filter((o) => o.code === t.payer_code && o.total - o.paid_amount > 4e-3);
      if (!cands.length) continue;
      const byNo = cands.filter((o) => purposeHasNo(t.purpose, o.invoice_no));
      if (!byNo.length && purposeNos(t.purpose).length) continue;
      let pool = byNo.length ? byNo : cands;
      if (pool.length > 1) {
        const exact = pool.filter((o) => Math.abs(due(o) - t.amount) <= DUE_EPS);
        if (exact.length === 1) pool = exact;
      }
      const hit = pool.length === 1 && t.amount <= due(pool[0]) + DUE_EPS ? pool[0] : null;
      await db.run(
        `INSERT OR IGNORE INTO b2b_payments (tx_id, order_id, candidates, amount, date, payer_name, payer_code, purpose, auto, created_at, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [t.id, hit?.id ?? null, JSON.stringify(hit ? [] : pool.map((o) => o.id)), t.amount, t.date, t.payer_name, t.payer_code, t.purpose, nowIso(), t.account || ""]
      );
      if (hit) {
        hit.paid_amount = round2(hit.paid_amount + t.amount);
        await recalc(hit.id, base);
      } else {
        const why = pool.length > 1 ? `\u043F\u0456\u0434\u0445\u043E\u0434\u0438\u0442\u044C \u043A\u0456\u043B\u044C\u043A\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u0435\u043B\u044C: ${pool.map((o) => `${orderNo(o.id)} (\u0437\u0430\u043B\u0438\u0448\u043E\u043A ${uah3(due(o))})`).join(", ")}` : `\u0441\u0443\u043C\u0430 \u0431\u0456\u043B\u044C\u0448\u0430 \u0437\u0430 \u0437\u0430\u043B\u0438\u0448\u043E\u043A ${uah3(due(pool[0]))} \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(pool[0].id)}`;
        await tgAdmins(`\u{1F4B3} <b>\u041F\u043B\u0430\u0442\u0456\u0436 \u0437\u0430 B2B \u2014 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435</b>: ${uah3(t.amount)} \u0432\u0456\u0434 ${h6(t.payer_name || t.payer_code)}
${why}.
\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0432\u0440\u0443\u0447\u043D\u0443 \u043D\u0430 \u0457\u0457 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0430\u0431\u043E \u0432 \xAB\u041F\u043B\u0430\u0442\u0435\u0436\u0430\u0445\xBB.${base ? `
${link(base, `b2borders/${pool[0].id}`)}` : ""}`);
      }
    }
  }
  async function payInfo(txIds) {
    if (!txIds.length) return /* @__PURE__ */ new Map();
    const rows = await db.all(`SELECT tx_id, order_id, candidates, dismissed FROM b2b_payments WHERE tx_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(txIds)]);
    return new Map(rows.map((r) => [r.tx_id, {
      order_id: r.order_id,
      number: r.order_id ? orderNo(r.order_id) : "",
      check: !r.order_id && !r.dismissed && r.candidates !== "[]",
      candidates: JSON.parse(r.candidates || "[]")
    }]));
  }
  async function supplyOf(c) {
    need(c, "b2b.admin");
    const o = await db.get(`SELECT o.*, e.code AS entity_code FROM b2b_orders o LEFT JOIN b2b_entities e ON e.id = o.entity_id WHERE o.id = ? AND o.kind = 'supply'`, [c.req.param("id")]);
    if (!o) throw fail(404, "\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return o;
  }
  app.get("/api/b2b/orders/:id/payments", async (c) => {
    const o = await supplyOf(c);
    const linked = await db.all(`SELECT tx_id, amount, date, payer_name, payer_code, purpose, auto FROM b2b_payments WHERE order_id = ? ORDER BY date`, [o.id]);
    const fromOdb = o.entity_code && services.payments?.txByPayer ? await services.payments.txByPayer(o.entity_code, 120) : [];
    const checks = o.entity_code ? (await db.all(`SELECT tx_id AS id, amount, date, payer_name, payer_code, purpose, candidates FROM b2b_payments
      WHERE payer_code = ? AND order_id IS NULL AND dismissed = 0`, [o.entity_code])).filter((t) => JSON.parse(t.candidates || "[]").includes(o.id)) : [];
    const used = new Set((await db.all(
      `SELECT tx_id FROM b2b_payments WHERE tx_id IN (SELECT value FROM json_each(?)) AND order_id IS NOT NULL`,
      [JSON.stringify([...checks, ...fromOdb].map((t) => t.id))]
    )).map((r) => r.tx_id));
    const seen = /* @__PURE__ */ new Set();
    const since = o.invoice_date || o.created_at.slice(0, 10);
    const possible = [...checks, ...fromOdb].filter((t) => !used.has(t.id) && !seen.has(t.id) && seen.add(t.id) && !foreignInvoice(t.purpose, o.invoice_no) && (t.date.slice(0, 10) >= since || purposeHasNo(t.purpose, o.invoice_no))).map((t) => ({ tx_id: t.id, amount: t.amount, date: t.date, payer_name: t.payer_name, payer_code: t.payer_code, purpose: t.purpose, hint: purposeHasNo(t.purpose, o.invoice_no) })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    return c.json({ linked, possible, due: round2(o.total - o.paid_amount), status: o.status });
  });
  app.post("/api/b2b/orders/:id/payments", async (c) => {
    const o = await supplyOf(c);
    if (!["pay_wait", "partial", "paid"].includes(o.status)) {
      throw fail(400, "\u041F\u043B\u0430\u0442\u0456\u0436 \u0437\u0430\u0440\u0430\u0445\u043E\u0432\u0443\u0454\u0442\u044C\u0441\u044F \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437 \u0440\u0430\u0445\u0443\u043D\u043A\u043E\u043C (\xAB\u041E\u0447\u0456\u043A\u0443\u0454 \u043E\u043F\u043B\u0430\u0442\u0443\xBB, \xAB\u0427\u0430\u0441\u0442\u043A\u043E\u0432\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB \u0430\u0431\u043E \xAB\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E\xBB).");
    }
    const txId = String((await c.req.json()).tx_id || "");
    const ex = await db.get(`SELECT tx_id, order_id FROM b2b_payments WHERE tx_id = ?`, [txId]);
    if (ex?.order_id && ex.order_id !== o.id) throw fail(400, `\u0426\u0435\u0439 \u043F\u043B\u0430\u0442\u0456\u0436 \u0443\u0436\u0435 \u0437\u0430\u0440\u0430\u0445\u043E\u0432\u0430\u043D\u043E \u0432 ${orderNo(ex.order_id)} \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0432\u0456\u0434\u0432'\u044F\u0436\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0442\u0430\u043C.`);
    const [tx] = services.payments?.txs ? await services.payments.txs([txId]) : [];
    const purpose = ex ? (await db.get(`SELECT purpose FROM b2b_payments WHERE tx_id = ?`, [txId]))?.purpose : tx?.purpose;
    if (foreignInvoice(purpose, o.invoice_no)) {
      throw fail(400, `\u0426\u0435 \u043E\u043F\u043B\u0430\u0442\u0430 \u0437\u0430 \u0456\u043D\u0448\u0438\u0439 \u0440\u0430\u0445\u0443\u043D\u043E\u043A (\u2116 ${purposeNos(purpose).join(", ")} \u0443 \u043F\u0440\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u0456), \u0430 \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u2014 \u2116 ${o.invoice_no || "\u2014"}.`);
    }
    if (o.status === "paid" && o.paid_by !== "Opendatabot") {
      await db.run(`UPDATE b2b_orders SET status = 'pay_wait', paid_amount = 0, paid_at = '', paid_by = '' WHERE id = ?`, [o.id]);
    }
    if (ex) {
      await db.run(
        `UPDATE b2b_payments SET order_id = ?, dismissed = 0, auto = 0, created_by = ?, account = COALESCE(NULLIF(account, ''), ?) WHERE tx_id = ?`,
        [o.id, userName3(c.get("user")), tx?.account || "", txId]
      );
    } else {
      const [t] = services.payments?.txs ? await services.payments.txs([txId]) : [];
      if (!t) throw fail(404, "\u041F\u043B\u0430\u0442\u0456\u0436 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E (\u0430\u0431\u043E \u0432\u0456\u043D \u0443\u0436\u0435 \u043F\u0440\u0438\u0432\u2019\u044F\u0437\u0430\u043D\u0438\u0439 \u0434\u043E \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043D\u0430 \u043E\u043F\u043B\u0430\u0442\u0443).");
      await db.run(
        `INSERT INTO b2b_payments (tx_id, order_id, candidates, amount, date, payer_name, payer_code, purpose, auto, created_at, created_by, account) VALUES (?, ?, '[]', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [t.id, o.id, t.amount, t.date, t.payer_name, t.payer_code, t.purpose, nowIso(), userName3(c.get("user")), t.account || ""]
      );
    }
    await log(o.id, c.get("user"), "\u0437\u0430\u0440\u0430\u0445\u043E\u0432\u0430\u043D\u043E \u043F\u043B\u0430\u0442\u0456\u0436 \u0432\u0440\u0443\u0447\u043D\u0443");
    await recalc(o.id, c, c.get("user"));
    return c.json({ ok: true });
  });
  app.post("/api/b2b/orders/:id/check-pay", async (c) => {
    let o = await supplyOf(c);
    const r = services.payments?.refresh ? await services.payments.refresh(new URL(c.req.url).origin) : { connected: false };
    if (!r.connected) throw fail(400, "Opendatabot \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E (\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u0440\u0430\u0445\u0443\u043D\u043A\u0456\u0432).");
    o = await supplyOf(c);
    const linked = await db.all(`SELECT tx_id, amount, date, payer_name, purpose FROM b2b_payments WHERE order_id = ? ORDER BY date`, [o.id]);
    const since = o.invoice_date || o.created_at.slice(0, 10);
    const fromPayer = o.entity_code && services.payments?.txByPayer ? await services.payments.txByPayer(o.entity_code, 120) : [];
    const elsewhere = new Map((await db.all(
      `SELECT tx_id, order_id FROM b2b_payments WHERE order_id IS NOT NULL AND tx_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(fromPayer.map((t) => t.id))]
    )).map((x) => [x.tx_id, x.order_id]));
    const others = fromPayer.filter((t) => !linked.some((l) => l.tx_id === t.id) && !elsewhere.has(t.id) && !foreignInvoice(t.purpose, o.invoice_no)).map((t) => ({
      tx_id: t.id,
      amount: t.amount,
      date: t.date,
      payer_name: t.payer_name,
      purpose: t.purpose,
      order: "",
      hint: purposeHasNo(t.purpose, o.invoice_no),
      before: t.date.slice(0, 10) < since
    })).filter((t) => !t.before || t.hint);
    const paidSum = round2(linked.reduce((a, t) => a + t.amount, 0));
    const verdict = paidSum >= o.total - DUE_EPS ? "confirmed" : paidSum > 0 ? "partial" : others.some((t) => !t.order && !t.before) ? "maybe" : "none";
    return c.json({ verdict, status: o.status, paid_by: o.paid_by, total: o.total, paid: paidSum, due: round2(Math.max(0, o.total - paidSum)), linked, others, added: r.added, code: o.entity_code || "" });
  });
  app.delete("/api/b2b/orders/:id/payments/:tx", async (c) => {
    const o = await supplyOf(c);
    const r = await db.run(`UPDATE b2b_payments SET order_id = NULL, dismissed = 1 WHERE tx_id = ? AND order_id = ?`, [c.req.param("tx"), o.id]);
    if (!r.changes) throw fail(404, "\u041F\u043B\u0430\u0442\u0456\u0436 \u043D\u0435 \u043F\u0440\u0438\u0432\u2019\u044F\u0437\u0430\u043D\u0438\u0439 \u0434\u043E \u0446\u0456\u0454\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456.");
    await log(o.id, c.get("user"), "\u0432\u0456\u0434\u0432\u2019\u044F\u0437\u0430\u043D\u043E \u043F\u043B\u0430\u0442\u0456\u0436");
    await recalc(o.id, c, c.get("user"));
    return c.json({ ok: true });
  });
  hooks.payReset = (orderId) => db.run(`UPDATE b2b_payments SET order_id = NULL, dismissed = 1 WHERE order_id = ?`, [orderId]);
  return { onPayments, payInfo, recalc };
}

// src/modules/b2b/edits.js
var INVOICED = ["pay_wait", "partial", "paid", "done"];
var userName4 = (u) => u?.name || u?.login || "";
var firstLine = (s) => String(s || "").split("\n")[0];
function mountB2bEdits(app, { db, orders, hooks, myPartner, partnerPrice: partnerPrice2 }) {
  const { orderOf, supplyLeft, itemRows, totalOf, log, tgPartner, tgGroup, link, uah: uah3, h: h6, rebuildOpen, getOpen, entityText } = orders;
  const partnerCatalog = (partnerId) => db.all(
    `SELECT c.product_id, c.name, c.article, c.rrp, m.margin FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id
     WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`,
    [partnerId]
  ).then((rows) => rows.map((r) => ({ product_id: r.product_id, name: r.name, article: r.article || "", rrp: r.rrp, price: partnerPrice2(r.rrp, r.margin) })));
  hooks.partnerCatalog = partnerCatalog;
  app.get("/api/b2b/orders/:id/edit-options", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    const [catalog, entities] = await Promise.all([
      partnerCatalog(o.partner_id),
      db.all(`SELECT id, name, code FROM b2b_entities WHERE partner_id = ? AND (active = 1 OR id = ?) ORDER BY name`, [o.partner_id, o.entity_id || 0])
    ]);
    return c.json({ catalog, entities, invoiced: Boolean(o.invoice_no) && INVOICED.includes(o.status) });
  });
  app.put("/api/b2b/orders/:id/edit", async (c) => {
    need(c, "b2b.admin");
    return c.json(await editSupply(c, await orderOf(c.req.param("id")), await c.req.json()));
  });
  hooks.supplyAdd = async (c, supplyId, add) => {
    const o = await orderOf(supplyId);
    const cur = await db.all(`SELECT product_id, qty FROM b2b_order_items WHERE order_id = ?`, [o.id]);
    const want = new Map(cur.map((i) => [i.product_id, i.qty]));
    for (const [id, n] of add) want.set(id, (want.get(id) || 0) + n);
    return editSupply(c, o, { items: [...want].map(([product_id, qty]) => ({ product_id, qty })) });
  };
  async function editSupply(c, o, b) {
    const u = c.get("user");
    if (o.kind !== "supply") throw fail(400, "\u0426\u0435 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u2014 \u0437\u043C\u0456\u043D\u044E\u0439\u0442\u0435 \u0439\u043E\u0433\u043E \u043D\u0430 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.");
    if (o.status === "cancelled") throw fail(400, "\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0441\u043A\u0430\u0441\u043E\u0432\u0430\u043D\u043E.");
    if (o.status === "open") throw fail(400, "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F \u0441\u043A\u043B\u0430\u0434\u0430\u0454\u0442\u044C\u0441\u044F \u0456\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u2014 \u0437\u043C\u0456\u043D\u0456\u0442\u044C \u0430\u0431\u043E \u0432\u0438\u0434\u0430\u043B\u0456\u0442\u044C \u0457\u0445, \u0456 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F \u043F\u0435\u0440\u0435\u0440\u0430\u0445\u0443\u0454\u0442\u044C\u0441\u044F \u0441\u0430\u043C\u0430.");
    const cur = await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const curMap = new Map(cur.map((i) => [i.product_id, i]));
    const want = /* @__PURE__ */ new Map();
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > 1e5) throw fail(400, "\u041A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u2014 \u0446\u0456\u043B\u0435 \u0447\u0438\u0441\u043B\u043E \u0432\u0456\u0434 0.");
      const raw2 = it.price === void 0 || it.price === null ? "" : String(it.price).replace(/\s/g, "").replace(",", ".");
      const price = raw2 === "" ? null : round2(Number(raw2));
      if (price !== null && !(price >= 0 && price < 1e8)) throw fail(400, "\u0426\u0456\u043D\u0430 \u2014 \u0447\u0438\u0441\u043B\u043E \u0432\u0456\u0434 0.");
      if (qty > 0) want.set(id, { qty: (want.get(id)?.qty || 0) + qty, price: price ?? want.get(id)?.price ?? null });
    }
    if (!want.size) throw fail(400, "\u0423 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u043C\u0430\u0454 \u043B\u0438\u0448\u0438\u0442\u0438\u0441\u044F \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0442\u043E\u0432\u0430\u0440. \u0429\u043E\u0431 \u043F\u0440\u0438\u0431\u0440\u0430\u0442\u0438 \u0432\u0441\u0435 \u2014 \u0432\u0438\u0434\u0430\u043B\u0456\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E.");
    if (want.size > 300) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 300 \u043F\u043E\u0437\u0438\u0446\u0456\u0439.");
    const newIds = [...want.keys()].filter((id) => !curMap.has(id));
    const cat = newIds.length ? new Map((await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, m.margin FROM b2b_catalog c LEFT JOIN b2b_margins m ON m.brand_id = c.brand_id AND m.partner_id = ?
       WHERE c.product_id IN (SELECT value FROM json_each(?))`,
      [o.partner_id, JSON.stringify(newIds)]
    )).map((r) => [r.product_id, r])) : /* @__PURE__ */ new Map();
    const items = [...want].map(([id, w]) => {
      const old = curMap.get(id);
      if (old) return { product_id: id, name: old.name, article: old.article || "", qty: w.qty, price: w.price ?? old.price, rrp: old.rrp };
      const r = cat.get(id);
      if (!r) throw fail(400, `\u0422\u043E\u0432\u0430\u0440\u0443 ID ${id} \u043D\u0435\u043C\u0430\u0454 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0437\u0456.`);
      return { product_id: id, name: r.name, article: r.article || "", qty: w.qty, price: w.price ?? partnerPrice2(r.rrp, r.margin || 0), rrp: r.rrp };
    });
    for (const r of await supplyLeft(o.id)) {
      if (r.used > (want.get(r.product_id)?.qty || 0)) throw fail(400, `\xAB${r.name}\xBB: \u043D\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u0443\u0436\u0435 \u0440\u043E\u0437\u043F\u0438\u0441\u0430\u043D\u043E ${r.used} \u0448\u0442. \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0437\u043C\u0456\u043D\u0456\u0442\u044C \u0430\u0431\u043E \u0432\u0438\u0434\u0430\u043B\u0456\u0442\u044C \u0446\u0456 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F.`);
    }
    let ent = { id: o.entity_id, text: o.entity };
    if (b.entity_id !== void 0 && b.entity_id !== null && Number(b.entity_id) !== Number(o.entity_id)) {
      const e = await db.get(`SELECT * FROM b2b_entities WHERE id = ? AND partner_id = ?`, [b.entity_id, o.partner_id]);
      if (!e) throw fail(404, "\u042E\u0440\u043E\u0441\u043E\u0431\u0443 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
      ent = { id: e.id, text: entityText(e) };
    }
    const comment = b.comment === void 0 ? o.comment || "" : String(b.comment).trim().slice(0, 1e3);
    const total = totalOf(items);
    const changes = [];
    for (const i of items) {
      const old = curMap.get(i.product_id);
      if (!old) {
        changes.push(`+ ${i.name} \xD7 ${i.qty} \u043F\u043E ${uah3(i.price)}`);
        continue;
      }
      if (old.qty !== i.qty) changes.push(`${i.name}: ${old.qty} \u2192 ${i.qty} \u0448\u0442`);
      if (round2(old.price) !== round2(i.price)) changes.push(`${i.name}: \u0446\u0456\u043D\u0430 ${uah3(old.price)} \u2192 ${uah3(i.price)}`);
    }
    const removed = cur.filter((i) => !want.has(i.product_id));
    for (const i of removed) changes.push(`\u2212 ${i.name} \xD7 ${i.qty} (\u043F\u0440\u0438\u0431\u0440\u0430\u043D\u043E)`);
    if (ent.id !== o.entity_id) changes.push(`\u044E\u0440\u043E\u0441\u043E\u0431\u0430: ${firstLine(ent.text)}`);
    if (comment !== (o.comment || "")) changes.push("\u043A\u043E\u043C\u0435\u043D\u0442\u0430\u0440");
    if (!changes.length) return { ok: true, changed: false };
    const invoiced = Boolean(o.invoice_no) && INVOICED.includes(o.status);
    const redo = invoiced ? `${o.invoice_no}${o.waybill_no ? ` (\u0456 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0443 \u2116 ${o.waybill_no})` : ""}` : "";
    const now = nowIso();
    const st = [[`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]], ...itemRows(o.id, items)];
    st.push(invoiced ? [
      `UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, status = 'invoice_wait', reinvoice = ?, reinvoiced_at = ?,
          invoice_no = '', invoice_date = '', waybill_no = '', due_date = '', due_notified = '', fin_done = 0, group_done = 0, updated_at = ? WHERE id = ?`,
      [total, ent.id, ent.text, comment, redo, now, now, o.id]
    ] : [`UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, group_done = 0, updated_at = ? WHERE id = ?`, [total, ent.id, ent.text, comment, now, o.id]]);
    for (const i of removed) {
      st.push([
        `INSERT INTO b2b_trash (kind, order_id, partner_id, title, total, data, deleted_by, by_partner, deleted_at) VALUES ('item', ?, ?, ?, ?, ?, ?, 0, ?)`,
        [o.id, o.partner_id, `${i.name} \xD7 ${i.qty} \u2014 \u0456\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(o.id)}`, round2(i.price * i.qty), JSON.stringify(i), userName4(u), now]
      ]);
    }
    await db.batch(st);
    await log(o.id, u, `\u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440: ${changes.join("; ")} \u2014 \u0440\u0430\u0437\u043E\u043C ${uah3(total)}${invoiced ? ` \xB7 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${redo} \u0442\u0440\u0435\u0431\u0430 \u043F\u0435\u0440\u0435\u0440\u043E\u0431\u0438\u0442\u0438` : ""}`.slice(0, 1800));
    if (o.status !== "draft") {
      const lines = changes.slice(0, 20).map(h6).join("\n");
      const text = `\u270F\uFE0F <b>\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)} \u0437\u043C\u0456\u043D\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440</b>
${lines}
<b>\u0420\u0430\u0437\u043E\u043C: ${uah3(total)}</b>${invoiced ? `

\u{1F501} \u0420\u0430\u0445\u0443\u043D\u043E\u043A \u2116 ${h6(o.invoice_no)} \u0431\u0443\u0434\u0435 \u043F\u0435\u0440\u0435\u0432\u0438\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u2014 \u043D\u043E\u0432\u0438\u0439 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0430\u0434\u0456\u0439\u0434\u0435 \u0441\u044E\u0434\u0438.${Number(o.paid_amount) > 0 ? ` \u041E\u043F\u043B\u0430\u0442\u0430 ${uah3(o.paid_amount)} \u0437\u0430\u0440\u0430\u0445\u043E\u0432\u0430\u043D\u0430.` : ""}` : ""}`;
      await tgPartner(o.partner_id, `${text}
${link(c, `porders/${o.id}`)}`);
      if (invoiced) await tgGroup(o.partner_id, text);
      await hooks.finRequest?.(o.id, invoiced ? "reinvoice" : "changed").catch(() => 0);
    }
    return { ok: true, changed: true, total, reinvoice: invoiced };
  }
  async function toTrash(o, u, { byPartner = false } = {}) {
    const [items, history] = await Promise.all([
      db.all(`SELECT * FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.all(`SELECT * FROM b2b_order_log WHERE order_id = ? ORDER BY id`, [o.id])
    ]);
    const title = o.kind === "client" ? `\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${orderNo(o.id)} \xB7 ${o.client_name || ""}` : `${o.status === "draft" ? "\u0427\u0435\u0440\u043D\u0435\u0442\u043A\u0430 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456" : "\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044F"} ${orderNo(o.id)}${o.entity ? ` \xB7 ${firstLine(o.entity).split(",")[0]}` : ""}`;
    await db.batch([
      [
        `INSERT INTO b2b_trash (kind, order_id, partner_id, title, total, data, deleted_by, by_partner, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [o.kind, o.id, o.partner_id, title, o.total || 0, JSON.stringify({ order: o, items, history }), userName4(u), byPartner ? 1 : 0, nowIso()]
      ],
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_order_log WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_orders WHERE id = ?`, [o.id]]
    ]);
  }
  hooks.toTrash = toTrash;
  app.delete("/api/b2b/orders/:id", async (c) => {
    need(c, "b2b.admin");
    const o = await orderOf(c.req.param("id"));
    if (o.kind === "supply") {
      const n = (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [o.id])).n;
      if (n) throw fail(400, `\u0417 \u0446\u0456\u0454\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0454 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 (${n}) \u2014 \u0441\u043F\u0435\u0440\u0448\u0443 \u0432\u0438\u0434\u0430\u043B\u0456\u0442\u044C \u0430\u0431\u043E \u0441\u043A\u0430\u0441\u0443\u0439\u0442\u0435 \u0457\u0445.`);
    }
    await toTrash(o, c.get("user"));
    await hooks.finClosed?.(o.id, "\u{1F5D1} \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E", o).catch(() => 0);
    if (o.kind === "client" && o.supply_id) await rebuildOpen(o.supply_id);
    if (o.status !== "draft") {
      await tgPartner(o.partner_id, `\u{1F5D1} ${o.kind === "client" ? `\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${orderNo(o.id)} (${h6(o.client_name)})` : `\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)}`} \u0432\u0438\u0434\u0430\u043B\u0438\u0432 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u2014 \u0439\u043E\u0433\u043E \u0432\u0438\u0434\u043D\u043E \u0432 \xAB\u041A\u043E\u0448\u0438\u043A\u0443\xBB.`);
    }
    await logAudit(db, { user: c.get("user"), kind: "b2b", refId: o.partner_id, action: `\u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E \u0432 \u043A\u043E\u0448\u0438\u043A ${o.kind === "client" ? "\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430" : "\u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E"} ${orderNo(o.id)} \u043D\u0430 ${uah3(o.total)}${o.crm_id ? ` (\u0443 LP-CRM \u2116 ${o.crm_id} \u2014 \u043D\u0435 \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E)` : ""}` }).catch(() => 0);
    return c.json({ ok: true, inCrm: o.crm_id || "" });
  });
  const trashRow = (r, forPartner = false) => ({
    id: r.id,
    kind: r.kind,
    order_id: r.order_id,
    number: r.order_id ? orderNo(r.order_id) : "",
    title: r.title,
    total: r.total,
    deleted_by: forPartner && !r.by_partner ? `\u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 ${r.deleted_by}` : r.deleted_by,
    by_partner: !!r.by_partner,
    deleted_at: r.deleted_at,
    restored_at: r.restored_at || "",
    restored_by: r.restored_by || "",
    partner: r.partner || "",
    partner_id: r.partner_id,
    can_restore: !forPartner && !r.restored_at && ["supply", "client"].includes(r.kind)
  });
  app.get("/api/b2b/trash", async (c) => {
    need(c, "b2b.admin");
    const pid = parseInt(c.req.query("partner"), 10) || 0;
    const rows = await db.all(`SELECT t.id, t.kind, t.order_id, t.partner_id, t.title, t.total, t.deleted_by, t.by_partner, t.deleted_at, t.restored_at, t.restored_by, p.name AS partner
      FROM b2b_trash t LEFT JOIN b2b_partners p ON p.id = t.partner_id ${pid ? "WHERE t.partner_id = ?" : ""} ORDER BY t.id DESC LIMIT 300`, pid ? [pid] : []);
    return c.json(rows.map((r) => trashRow(r)));
  });
  app.get("/api/b2b/p/trash", async (c) => {
    const p = await myPartner(c);
    const rows = await db.all(`SELECT id, kind, order_id, partner_id, title, total, deleted_by, by_partner, deleted_at, restored_at, restored_by
      FROM b2b_trash WHERE partner_id = ? ORDER BY id DESC LIMIT 300`, [p.id]);
    return c.json(rows.map((r) => trashRow(r, true)));
  });
  app.post("/api/b2b/trash/:id/restore", async (c) => {
    need(c, "b2b.admin");
    const u = c.get("user");
    const t = await db.get(`SELECT * FROM b2b_trash WHERE id = ?`, [c.req.param("id")]);
    if (!t) throw fail(404, "\u0417\u0430\u043F\u0438\u0441 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (t.restored_at) throw fail(400, "\u0423\u0436\u0435 \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043E.");
    if (!["supply", "client"].includes(t.kind)) throw fail(400, "\u041F\u0440\u0438\u0431\u0440\u0430\u043D\u0438\u0439 \u0442\u043E\u0432\u0430\u0440 \u043D\u0435 \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u044E\u0454\u0442\u044C\u0441\u044F \u2014 \u0434\u043E\u0434\u0430\u0439\u0442\u0435 \u0439\u043E\u0433\u043E \u0432 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0437\u043D\u043E\u0432\u0443 (\xAB\u0417\u043C\u0456\u043D\u0438\u0442\u0438\xBB).");
    const d = JSON.parse(t.data || "{}");
    const o = { ...d.order };
    if (!o.id) throw fail(400, "\u041D\u0435\u043C\u0430\u0454 \u0434\u0430\u043D\u0438\u0445 \u0434\u043B\u044F \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F.");
    if (await db.get(`SELECT id FROM b2b_orders WHERE id = ?`, [o.id])) throw fail(409, `${orderNo(o.id)} \u0443\u0436\u0435 \u0454.`);
    let openId = null;
    if (o.kind === "client" && o.status !== "cancelled") {
      const s = o.supply_id ? await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
      if (s && !["open", "cancelled"].includes(s.status)) {
        const left = new Map((await supplyLeft(s.id)).map((r) => [r.product_id, r.left]));
        for (const i of d.items || []) {
          if ((left.get(i.product_id) ?? 0) < i.qty) throw fail(400, `\u0423 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 ${orderNo(s.id)} \u0443\u0436\u0435 \u043D\u0435\u043C\u0430\u0454 \u0437\u0430\u043B\u0438\u0448\u043A\u0443 \xAB${i.name}\xBB (${i.qty} \u0448\u0442.) \u2014 \u0437\u0432\u0456\u043B\u044C\u043D\u0456\u0442\u044C \u0442\u043E\u0432\u0430\u0440 \u0430\u0431\u043E \u0437\u043C\u0456\u043D\u0456\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E.`);
        }
      } else {
        openId = (await getOpen(o.partner_id))?.id || null;
        if (!openId) {
          const now2 = nowIso();
          openId = (await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, entity, total, created_by, created_at, updated_at) VALUES (?, 'supply', 'open', '', 0, '\u0430\u0432\u0442\u043E', ?, ?)`, [o.partner_id, now2, now2])).lastId;
          await db.run(`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, '\u0430\u0432\u0442\u043E', '\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E \u0456\u0437 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u043A\u043B\u0456\u0454\u043D\u0442\u0456\u0432 \u0431\u0435\u0437 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456')`, [openId, now2]);
        }
        o.supply_id = openId;
      }
    }
    const cols = Object.keys(o);
    const now = nowIso();
    await db.batch([
      [`INSERT INTO b2b_orders (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((k) => o[k])],
      ...(d.items || []).map((i) => [
        `INSERT INTO b2b_order_items (order_id, product_id, name, article, qty, price, rrp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [o.id, i.product_id, i.name, i.article || "", i.qty, i.price, i.rrp ?? 0]
      ]),
      ...(d.history || []).map((x) => [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [o.id, x.at, x.user_name, x.action]]),
      [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [o.id, now, userName4(u), `\u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0437 \u043A\u043E\u0448\u0438\u043A\u0430${openId ? ` (\u0443 \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0443 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(openId)})` : ""}`]],
      [`UPDATE b2b_trash SET restored_at = ?, restored_by = ? WHERE id = ?`, [now, userName4(u), t.id]]
    ]);
    if (openId) await rebuildOpen(openId);
    await tgPartner(o.partner_id, `\u21A9\uFE0F ${o.kind === "client" ? `\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ${orderNo(o.id)} (${h6(o.client_name)})` : `\u0417\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u044E ${orderNo(o.id)}`} \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u0437 \u043A\u043E\u0448\u0438\u043A\u0430.`);
    return c.json({ ok: true, id: o.id, kind: o.kind });
  });
}

// src/modules/b2b/index.js
var partnerPrice = (rrp, margin) => round2((Number(rrp) || 0) * (1 - (Number(margin) || 0) / 100));
var BATCH = 50;
var BATCHES_PER_CALL = 8;
var IMG_RE = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;
function collectProducts(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return [];
  if (!Array.isArray(node) && ("id" in node || "product_id" in node) && ("name" in node || "price" in node)) return [node];
  return Object.values(node).flatMap((v) => collectProducts(v, depth + 1));
}
function findImage(node, depth = 0) {
  if (typeof node === "string") return IMG_RE.test(node.trim()) ? node.trim() : "";
  if (!node || typeof node !== "object" || depth > 3) return "";
  for (const v of Object.values(node)) {
    const found = findImage(v, depth + 1);
    if (found) return found;
  }
  return "";
}
var num3 = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
function mountB2b(app, { db, fetchFn, services = {}, onCleanup = () => {
} }) {
  const audit = (c, refId, action, changes = []) => logAudit(db, { user: c.get("user"), kind: "b2b", refId, action, changes });
  async function brandNames() {
    const rows = await db.all(`SELECT id, name FROM an_brands ORDER BY sort, id`).catch(() => []);
    return new Map([...rows.map((r) => [r.id, r.name]), [0, "\u0406\u043D\u0448\u0456"]]);
  }
  app.use("/api/b2b/p/*", async (c, next) => {
    const u = c.get("user");
    if (u?.role === "partner" && c.req.method !== "GET" && !can(u, "b2b.order")) throw fail(403, "\u0423 \u0432\u0430\u0441 \u0434\u043E\u0441\u0442\u0443\u043F \u043B\u0438\u0448\u0435 \u043D\u0430 \u043F\u0435\u0440\u0435\u0433\u043B\u044F\u0434. \u0417\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043A\u0435\u0440\u0456\u0432\u043D\u0438\u043A\u0430 \u0432\u0430\u0448\u043E\u0457 \u043A\u043E\u043C\u0430\u043D\u0434\u0438.");
    if (u?.role === "partner" && c.req.method === "POST" && /^\/api\/b2b\/p\/(orders|clients|orders\/\d+\/send)\/?$/.test(c.req.path)) {
      const p = await db.get(`SELECT paused, pause_note FROM b2b_partners WHERE id = ?`, [u.partner_id]);
      if (p?.paused) throw fail(403, `\u041D\u043E\u0432\u0456 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456 \u0439 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u043E \u043F\u0440\u0438\u0437\u0443\u043F\u0438\u043D\u0435\u043D\u043E${p.pause_note ? `: ${p.pause_note}` : ""}. \u0417\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.`);
    }
    await next();
  });
  app.get("/api/b2b/partners", async (c) => {
    need(c, "b2b.admin");
    const rows = await db.all(`SELECT p.*,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner') AS users,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.added_by LIKE 'partner:%') AS users_by_partner,
        (SELECT COUNT(*) FROM b2b_margins m WHERE m.partner_id = p.id) AS brands
      FROM b2b_partners p WHERE COALESCE(p.deleted_at, '') = '' ORDER BY p.active DESC, p.name`);
    const today2 = (/* @__PURE__ */ new Date()).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
    const debt = new Map((await db.all(`SELECT partner_id, SUM(total - paid_amount) AS due, SUM(CASE WHEN due_date != '' AND due_date < ? THEN total - paid_amount ELSE 0 END) AS overdue,
      COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' AND status IN ('pay_wait', 'partial') GROUP BY partner_id`, [today2])).map((r) => [r.partner_id, r]));
    const ship = new Map((await db.all(`SELECT s.partner_id, SUM(co.total) AS sum, COUNT(co.id) AS n FROM b2b_orders s
      JOIN b2b_orders co ON co.supply_id = s.id AND co.kind = 'client' AND co.status = 'crm'
      WHERE s.kind = 'supply' AND s.status IN ('open', 'invoice_wait') GROUP BY s.partner_id`)).map((r) => [r.partner_id, r]));
    const r2 = (n) => Math.round((n || 0) * 100) / 100;
    return c.json(rows.map((r) => ({
      ...r,
      debt: r2((debt.get(r.id)?.due || 0) + (ship.get(r.id)?.sum || 0)),
      debt_invoiced: r2(debt.get(r.id)?.due),
      debt_shipped: r2(ship.get(r.id)?.sum),
      debt_shipped_cnt: ship.get(r.id)?.n || 0,
      debt_overdue: r2(debt.get(r.id)?.overdue),
      debt_cnt: debt.get(r.id)?.n || 0
    })));
  });
  const partnerFields = (b) => ({
    name: String(b.name ?? "").trim().slice(0, 120),
    phone: String(b.phone ?? "").trim().slice(0, 40),
    email: String(b.email ?? "").trim().slice(0, 120),
    note: String(b.note ?? "").trim().slice(0, 1e3)
  });
  app.post("/api/b2b/partners", async (c) => {
    need(c, "b2b.admin");
    const f = partnerFields(await c.req.json());
    if (!f.name) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043D\u0430\u0437\u0432\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430.");
    const r = await db.run(
      `INSERT INTO b2b_partners (name, phone, email, note, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      [f.name, f.phone, f.email, f.note, nowIso()]
    );
    await audit(c, r.lastId, `\u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \xAB${f.name}\xBB`);
    return c.json({ id: r.lastId });
  });
  async function getPartner(id) {
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ? AND COALESCE(deleted_at, '') = ''`, [id]);
    if (!p) throw fail(404, "\u041F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    return p;
  }
  app.get("/api/b2b/partners/:id", async (c) => {
    need(c, "b2b.admin");
    const p = await getPartner(c.req.param("id"));
    const [users, margins, counts, names, entities] = await Promise.all([
      services.notify?.fillTgNames?.(5).catch(() => 0).then(() => db.all(`SELECT id, login, name, active, created_at, partner_role, added_by, tg_chat_id, tg_name, tg_linked_at FROM users WHERE partner_id = ? AND role = 'partner' ORDER BY active DESC, login`, [p.id])),
      db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id]),
      db.all(`SELECT brand_id, COUNT(*) AS n, SUM(CASE WHEN rrp > 0 THEN 1 ELSE 0 END) AS priced FROM b2b_catalog WHERE hidden = 0 GROUP BY brand_id`),
      brandNames(),
      db.all(`SELECT * FROM b2b_entities WHERE partner_id = ? ORDER BY active DESC, name`, [p.id])
    ]);
    const m = new Map(margins.map((x) => [x.brand_id, x.margin]));
    const cnt = new Map(counts.map((x) => [x.brand_id, x]));
    const brands = [...names].map(([id, name]) => ({
      id,
      name,
      enabled: m.has(id),
      margin: m.get(id) ?? null,
      products: cnt.get(id)?.n || 0,
      priced: cnt.get(id)?.priced || 0
    }));
    const lim = orders.limitsOf(p);
    const open = await orders.getOpen(p.id);
    return c.json({
      partner: p,
      users: users.map(teamRow),
      brands,
      entities,
      roles: PARTNER_ROLES,
      limits: { open: lim.open, unpaid: lim.unpaid, openTotal: open?.total || 0, openId: open?.id || null, unpaidTotal: await orders.unpaidTotal(p.id) },
      postpay: await orders.postpayInfo(p),
      debt: await orders.debtOf(p.id)
    });
  });
  app.delete("/api/b2b/partners/:id", async (c) => {
    need(c, "b2b.admin");
    need(c, "people");
    const p = await getPartner(c.req.param("id"));
    const hasOrders = await db.get(`SELECT id FROM b2b_orders WHERE partner_id = ? LIMIT 1`, [p.id]);
    const st = [
      [`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE partner_id = ? AND role = 'partner')`, [p.id]],
      [`DELETE FROM users WHERE partner_id = ? AND role = 'partner'`, [p.id]],
      [`DELETE FROM b2b_margins WHERE partner_id = ?`, [p.id]]
    ];
    if (hasOrders) st.push([`UPDATE b2b_partners SET active = 0, deleted_at = ? WHERE id = ?`, [nowIso(), p.id]]);
    else {
      st.push([`DELETE FROM b2b_margin_log WHERE partner_id = ?`, [p.id]]);
      st.push([`DELETE FROM b2b_entities WHERE partner_id = ?`, [p.id]]);
      st.push([`DELETE FROM b2b_partners WHERE id = ?`, [p.id]]);
    }
    await db.batch(st);
    await audit(c, p.id, `${hasOrders ? "\u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E (\u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E \u0432 \u0430\u0440\u0445\u0456\u0432\u0456)" : "\u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0432\u0438\u0434\u0430\u043B\u0435\u043D\u043E"}: \xAB${p.name}\xBB`);
    return c.json({ ok: true, archived: !!hasOrders });
  });
  async function applyLimits(c, p, b) {
    const st = [];
    const log = [];
    if (b.postpay_days !== void 0) {
      const v = parseInt(b.postpay_days, 10) || 0;
      if (v < 0 || v > 180) throw fail(400, "\u0412\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0430 \u2014 \u0432\u0456\u0434 0 \u0434\u043E 180 \u0434\u043D\u0456\u0432.");
      if (v !== (Number(p.postpay_days) || 0)) {
        st.push([`UPDATE b2b_partners SET postpay_days = ? WHERE id = ?`, [v, p.id]]);
        log.push(v ? `\u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0430 \u043E\u043F\u043B\u0430\u0442\u0438: ${v} \u0434\u043D.` : "\u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0443 \u043E\u043F\u043B\u0430\u0442\u0438 \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E");
      }
    }
    for (const [k, label] of [["open_limit", "\u0432\u0456\u0434\u043A\u0440\u0438\u0442\u043E\u0457 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456"], ["unpaid_limit", "\u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0438\u0445 \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u0435\u043B\u044C"], ["postpay_limit", "\u0432\u0456\u0434\u0441\u0442\u0440\u043E\u0447\u043A\u0438"]]) {
      if (b[k] === void 0) continue;
      const raw2 = String(b[k] ?? "").replace(/\s/g, "");
      if (raw2 && !/^\d+([.,]\d+)?$/.test(raw2)) throw fail(400, `\u041B\u0456\u043C\u0456\u0442 ${label} \u2014 \u0441\u0443\u043C\u0430 \u0432 \u0433\u0440\u0438\u0432\u043D\u044F\u0445.`);
      const v = raw2 ? round2(num3(raw2)) : null;
      if (v !== null && !(v >= 0 && v <= 1e8)) throw fail(400, `\u041B\u0456\u043C\u0456\u0442 ${label} \u2014 \u0441\u0443\u043C\u0430 \u0432 \u0433\u0440\u0438\u0432\u043D\u044F\u0445.`);
      if (v !== (p[k] ?? null)) {
        st.push([`UPDATE b2b_partners SET ${k} = ? WHERE id = ?`, [v, p.id]]);
        log.push(`\u043B\u0456\u043C\u0456\u0442 ${label}: ${p[k] ?? "\u0442\u0438\u043F\u043E\u0432\u0438\u0439"} \u2192 ${v ?? "\u0442\u0438\u043F\u043E\u0432\u0438\u0439"}`);
      }
    }
    if (st.length) await db.batch(st);
    for (const x of log) await audit(c, p.id, x);
    return log.length;
  }
  async function applyPause(c, p, b) {
    if (b.paused === void 0) return 0;
    const v = b.paused ? 1 : 0;
    const note = v ? String(b.pause_note ?? p.pause_note ?? "").trim().slice(0, 300) : "";
    if (v === (Number(p.paused) || 0) && note === (p.pause_note || "")) return 0;
    await db.run(`UPDATE b2b_partners SET paused = ?, pause_note = ? WHERE id = ?`, [v, note, p.id]);
    await audit(c, p.id, v ? `\u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E \u043D\u0430 \u043F\u0430\u0443\u0437\u0443${note ? `: ${note}` : ""}` : "\u043F\u0430\u0443\u0437\u0443 \u0437\u043D\u044F\u0442\u043E");
    return 1;
  }
  app.put("/api/b2b/partners/:id", async (c) => {
    need(c, "b2b.admin");
    const p = await getPartner(c.req.param("id"));
    const b = await c.req.json();
    const f = { ...partnerFields({ ...p, ...b }) };
    if (!f.name) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043D\u0430\u0437\u0432\u0443 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430.");
    const active = b.active === void 0 ? p.active : b.active ? 1 : 0;
    await applyLimits(c, p, b);
    await applyPause(c, p, b);
    await db.run(`UPDATE b2b_partners SET name = ?, phone = ?, email = ?, note = ?, active = ? WHERE id = ?`, [f.name, f.phone, f.email, f.note, active, p.id]);
    if (!active && p.active) {
      await db.batch([
        [`UPDATE users SET active = 0 WHERE partner_id = ? AND role = 'partner'`, [p.id]],
        [`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE partner_id = ? AND role = 'partner')`, [p.id]]
      ]);
    }
    if (active !== p.active) await audit(c, p.id, active ? "\u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0443\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u043E" : "\u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E");
    return c.json({ ok: true });
  });
  async function applyMargins(c, p, build, names = null) {
    const cur = new Map((await db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id])).map((x) => [x.brand_id, x.margin]));
    const next = build(cur);
    names = names || await brandNames();
    const at = nowIso();
    const st = [];
    const changes = [];
    for (const [brand, margin] of next) {
      if (cur.get(brand) === margin) continue;
      st.push([`INSERT INTO b2b_margins (partner_id, brand_id, margin) VALUES (?, ?, ?) ON CONFLICT(partner_id, brand_id) DO UPDATE SET margin = excluded.margin`, [p.id, brand, margin]]);
      st.push([`INSERT INTO b2b_margin_log (at, partner_id, brand_id, old_margin, new_margin) VALUES (?, ?, ?, ?, ?)`, [at, p.id, brand, cur.has(brand) ? cur.get(brand) : null, margin]]);
      changes.push({ field: names.get(brand) || `\u0431\u0440\u0435\u043D\u0434 ${brand}`, from: cur.has(brand) ? `${cur.get(brand)}%` : "\u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E", to: `${margin}%` });
    }
    for (const [brand, margin] of cur) {
      if (next.has(brand)) continue;
      st.push([`DELETE FROM b2b_margins WHERE partner_id = ? AND brand_id = ?`, [p.id, brand]]);
      st.push([`INSERT INTO b2b_margin_log (at, partner_id, brand_id, old_margin, new_margin) VALUES (?, ?, ?, ?, NULL)`, [at, p.id, brand, margin]]);
      changes.push({ field: names.get(brand) || `\u0431\u0440\u0435\u043D\u0434 ${brand}`, from: `${margin}%`, to: "\u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E" });
    }
    if (st.length) await db.batch(st);
    if (changes.length) await audit(c, p.id, `\u0431\u0440\u0435\u043D\u0434\u0438 \u0439 \u043C\u0430\u0440\u0436\u0430 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \xAB${p.name}\xBB`, changes);
    return changes;
  }
  app.post("/api/b2b/partners/bulk", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((x) => x > 0))];
    if (!ids.length) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0456\u0432.");
    if (ids.length > 200) throw fail(400, "\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 200 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0456\u0432 \u0437\u0430 \u0440\u0430\u0437.");
    const list = await db.all(`SELECT * FROM b2b_partners WHERE COALESCE(deleted_at, '') = '' AND id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
    let margin = null;
    if (b.action === "margin") {
      const mode = ["set", "add", "disable"].includes(b.mode) ? b.mode : "";
      if (!mode) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u0434\u0456\u044E \u0437 \u043C\u0430\u0440\u0436\u0435\u044E.");
      const brand = b.brand === "all" ? "all" : parseInt(b.brand, 10);
      if (brand !== "all" && !(brand >= 0)) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u0431\u0440\u0435\u043D\u0434.");
      const v = round2(num3(b.value));
      if (mode === "set" && (v < 0 || v >= 100)) throw fail(400, "\u041C\u0430\u0440\u0436\u0430 \u2014 \u0432\u0456\u0434 0 \u0434\u043E 99,99 %.");
      if (mode === "add" && (!v || Math.abs(v) >= 100)) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C, \u043D\u0430 \u0441\u043A\u0456\u043B\u044C\u043A\u0438 \u0437\u043C\u0456\u043D\u0438\u0442\u0438 \u043C\u0430\u0440\u0436\u0443 (\u043D\u0430\u043F\u0440. 2 \u0430\u0431\u043E -1,5).");
      if (mode === "disable" && brand === "all") throw fail(400, "\u0412\u0438\u043C\u0438\u043A\u0430\u0442\u0438 \u043C\u043E\u0436\u043D\u0430 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u0438\u0439 \u0431\u0440\u0435\u043D\u0434.");
      margin = { mode, brand, v, enable: !!b.enable && brand !== "all" && mode === "set" };
    } else if (!["pause", "resume", "limits"].includes(b.action)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0434\u0456\u044F.");
    const names = await brandNames();
    const results = [];
    for (const p of list) {
      try {
        let changed = 0;
        if (b.action === "pause") changed = await applyPause(c, p, { paused: 1, pause_note: b.note ?? "" });
        else if (b.action === "resume") changed = await applyPause(c, p, { paused: 0 });
        else if (b.action === "limits") {
          const f = {};
          for (const k of ["open_limit", "unpaid_limit", "postpay_days", "postpay_limit"]) if (b[k] !== void 0 && b[k] !== null) f[k] = b[k];
          changed = await applyLimits(c, p, f);
        } else {
          const { mode, brand, v, enable } = margin;
          changed = (await applyMargins(c, p, (cur) => {
            const next = new Map(cur);
            const targets = brand === "all" ? [...cur.keys()] : cur.has(brand) || enable ? [brand] : [];
            for (const id of targets) {
              if (mode === "disable") next.delete(id);
              else if (mode === "set") next.set(id, v);
              else next.set(id, Math.min(99.99, Math.max(0, round2((cur.get(id) || 0) + v))));
            }
            return next;
          }, names)).length;
        }
        results.push({ id: p.id, name: p.name, ok: true, changed });
      } catch (e) {
        results.push({ id: p.id, name: p.name, ok: false, error: e.message });
      }
    }
    return c.json({ results });
  });
  app.put("/api/b2b/partners/:id/margins", async (c) => {
    need(c, "b2b.admin");
    const p = await getPartner(c.req.param("id"));
    const list = await c.req.json();
    if (!Array.isArray(list)) throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0456 \u0434\u0430\u043D\u0456.");
    const next = /* @__PURE__ */ new Map();
    for (const r of list) {
      const brand = parseInt(r.brand_id, 10);
      const margin = round2(num3(r.margin));
      if (!Number.isFinite(brand) || brand < 0) continue;
      if (margin < 0 || margin >= 100) throw fail(400, "\u041C\u0430\u0440\u0436\u0430 \u2014 \u0432\u0456\u0434 0 \u0434\u043E 99,99 %.");
      next.set(brand, margin);
    }
    const changes = await applyMargins(c, p, () => next);
    return c.json({ ok: true, changed: changes.length });
  });
  const MAX_TEAM = 30;
  const teamRow = (u) => {
    const [by, ...who] = String(u.added_by || "").split(":");
    return {
      id: u.id,
      login: u.login,
      name: u.name || "",
      active: u.active,
      created_at: u.created_at,
      partner_role: partnerRole(u),
      partner_role_name: PARTNER_ROLES[partnerRole(u)],
      added_by_partner: by === "partner",
      added_by_name: who.join(":"),
      tg: { connected: Boolean(u.tg_chat_id), name: u.tg_name || "", at: u.tg_linked_at || "" }
    };
  };
  const roleOf = (v, fallback = "head") => PARTNER_ROLES[v] ? v : fallback;
  const actorName = (c) => c.get("user")?.name || c.get("user")?.login || "";
  async function addTeamUser(c, p, b, addedBy) {
    const login = String(b.login || "").trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw fail(400, "\u041B\u043E\u0433\u0456\u043D: \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438, \u043A\u0440\u0430\u043F\u043A\u0430, \u0434\u0435\u0444\u0456\u0441 (2\u201340 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432).");
    if (String(b.password || "").length < 6) throw fail(400, "\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
    if (await db.get(`SELECT id FROM users WHERE login = ?`, [login])) throw fail(400, "\u0422\u0430\u043A\u0438\u0439 \u043B\u043E\u0433\u0456\u043D \u0443\u0436\u0435 \u0437\u0430\u0439\u043D\u044F\u0442\u0438\u0439 \u2014 \u043E\u0431\u0435\u0440\u0456\u0442\u044C \u0456\u043D\u0448\u0438\u0439.");
    if ((await db.get(`SELECT COUNT(*) AS n FROM users WHERE partner_id = ? AND role = 'partner'`, [p.id])).n >= MAX_TEAM) throw fail(400, `\u0423 \u043A\u043E\u043C\u0430\u043D\u0434\u0456 \u043D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 ${MAX_TEAM} \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0456\u0432.`);
    const role = roleOf(b.partner_role, addedBy.startsWith("partner:") ? "staff" : "head");
    const r = await db.run(
      `INSERT INTO users (login, name, password_hash, role, active, created_at, partner_id, partner_role, added_by) VALUES (?, ?, ?, 'partner', 1, ?, ?, ?, ?)`,
      [login, String(b.name || "").trim().slice(0, 100), await hashPassword(b.password), nowIso(), p.id, role, addedBy]
    );
    await audit(c, p.id, `\u0434\u043E\u0434\u0430\u043D\u043E \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \xAB${p.name}\xBB: ${login} (${PARTNER_ROLES[role]})${addedBy.startsWith("partner:") ? " \u2014 \u0434\u043E\u0434\u0430\u0432 \u043F\u0430\u0440\u0442\u043D\u0435\u0440" : ""}`);
    return { id: r.lastId, login, role };
  }
  async function updateTeamUser(c, p, u, b, { byPartner = false } = {}) {
    const sets = [];
    const vals = [];
    const changes = [];
    const me = c.get("user");
    if (byPartner && u.id === me.id && (b.partner_role !== void 0 && roleOf(b.partner_role) !== partnerRole(u) || b.active === false)) {
      throw fail(400, "\u0421\u0432\u043E\u044E \u0440\u043E\u043B\u044C \u0447\u0438 \u0434\u043E\u0441\u0442\u0443\u043F \u0437\u043C\u0456\u043D\u0438\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430 \u2014 \u043F\u043E\u043F\u0440\u043E\u0441\u0456\u0442\u044C \u0456\u043D\u0448\u043E\u0433\u043E \u043A\u0435\u0440\u0456\u0432\u043D\u0438\u043A\u0430.");
    }
    if (b.name !== void 0) {
      sets.push("name = ?");
      vals.push(String(b.name).trim().slice(0, 100));
    }
    if (b.partner_role !== void 0 && roleOf(b.partner_role) !== partnerRole(u)) {
      sets.push("partner_role = ?");
      vals.push(roleOf(b.partner_role));
      changes.push(`\u0440\u043E\u043B\u044C: ${PARTNER_ROLES[roleOf(b.partner_role)]}`);
    }
    if (b.active !== void 0 && (b.active ? 1 : 0) !== u.active) {
      sets.push("active = ?");
      vals.push(b.active ? 1 : 0);
      changes.push(b.active ? "\u0443\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u043E" : "\u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E");
    }
    if (b.password) {
      if (String(b.password).length < 6) throw fail(400, "\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
      sets.push("password_hash = ?");
      vals.push(await hashPassword(b.password));
      changes.push("\u043D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C");
    }
    const willBeHead = (b.partner_role !== void 0 ? roleOf(b.partner_role) : partnerRole(u)) === "head" && (b.active !== void 0 ? !!b.active : !!u.active);
    if (!willBeHead && partnerRole(u) === "head" && u.active) {
      const heads = (await db.all(`SELECT id, partner_role FROM users WHERE partner_id = ? AND role = 'partner' AND active = 1 AND id != ?`, [p.id, u.id])).filter((x) => partnerRole(x) === "head").length;
      if (!heads) throw fail(400, "\u0423 \u043A\u043E\u043C\u0430\u043D\u0434\u0456 \u043C\u0430\u0454 \u043B\u0438\u0448\u0438\u0442\u0438\u0441\u044F \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0430\u043A\u0442\u0438\u0432\u043D\u0438\u0439 \u043A\u0435\u0440\u0456\u0432\u043D\u0438\u043A.");
    }
    if (sets.length) await db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, u.id]);
    if (b.password || b.active === false) await db.run(`DELETE FROM sessions WHERE user_id = ? AND user_id != ?`, [u.id, me.id]);
    if (changes.length) await audit(c, p.id, `\u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \xAB${p.name}\xBB ${u.login}: ${changes.join(", ")}${byPartner ? " \u2014 \u0437\u043C\u0456\u043D\u0438\u0432 \u043F\u0430\u0440\u0442\u043D\u0435\u0440" : ""}`);
  }
  app.post("/api/b2b/partners/:id/users", async (c) => {
    need(c, "b2b.admin");
    need(c, "people");
    const p = await getPartner(c.req.param("id"));
    const r = await addTeamUser(c, p, await c.req.json(), `staff:${actorName(c)}`);
    return c.json({ id: r.id });
  });
  app.put("/api/b2b/partners/:id/users/:uid", async (c) => {
    need(c, "b2b.admin");
    need(c, "people");
    const p = await getPartner(c.req.param("id"));
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND partner_id = ? AND role = 'partner'`, [c.req.param("uid"), p.id]);
    if (!u) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    await updateTeamUser(c, p, u, await c.req.json());
    return c.json({ ok: true });
  });
  app.get("/api/b2b/catalog", async (c) => {
    need(c, "b2b.admin");
    const brand = c.req.query("brand");
    const q = String(c.req.query("q") || "").trim().toLowerCase();
    const where = [];
    const params = [];
    if (brand !== void 0 && brand !== "") {
      where.push("brand_id = ?");
      params.push(parseInt(brand, 10) || 0);
    }
    if (q) {
      where.push("(LOWER(name) LIKE ? OR CAST(product_id AS TEXT) = ?)");
      params.push(`%${q}%`, q);
    }
    const [rows, names, state] = await Promise.all([
      db.all(`SELECT * FROM b2b_catalog ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY brand_id, name LIMIT 500`, params),
      brandNames(),
      catalogState()
    ]);
    return c.json({ rows: rows.map((r) => ({ ...r, brand: names.get(r.brand_id) || "\u0406\u043D\u0448\u0456" })), state });
  });
  async function catalogState(today2 = kyivDay()) {
    const [last, left] = await Promise.all([
      db.get(`SELECT value FROM settings WHERE key = 'b2b_catalog_sync'`),
      db.get(`SELECT COUNT(*) AS n FROM b2b_catalog WHERE hidden = 0 AND checked_at < ? AND (manual = 1 OR brand_id IN (SELECT brand_id FROM b2b_margins))`, [today2])
    ]);
    return { lastSync: last?.value || "", stale: left?.n || 0 };
  }
  app.put("/api/b2b/catalog/:pid", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json();
    await db.run(`UPDATE b2b_catalog SET hidden = ? WHERE product_id = ?`, [b.hidden ? 1 : 0, parseInt(c.req.param("pid"), 10) || 0]);
    return c.json({ ok: true });
  });
  app.post("/api/b2b/catalog/add", async (c) => {
    need(c, "b2b.admin");
    const b = await c.req.json();
    const ids = [...new Set(String(b.ids || "").split(/[\s,;]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 200);
    if (!ids.length) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C ID \u0442\u043E\u0432\u0430\u0440\u0456\u0432 \u0437 LP-CRM \u0447\u0435\u0440\u0435\u0437 \u043A\u043E\u043C\u0443.");
    await db.batch(ids.map((id) => [
      `INSERT INTO b2b_catalog (product_id, manual, checked_at) VALUES (?, 1, '') ON CONFLICT(product_id) DO UPDATE SET manual = 1, hidden = 0, checked_at = ''`,
      [id]
    ]));
    return c.json({ ok: true, added: ids.length });
  });
  app.post("/api/b2b/catalog/sync", async (c) => {
    need(c, "b2b.admin");
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, "\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u043F\u0456\u0434\u0434\u043E\u043C\u0435\u043D \u0456 API-\u043A\u043B\u044E\u0447 \u0443 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445\xBB.");
    const b = await c.req.json().catch(() => ({}));
    const run = String(b.run || "");
    const fresh = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(run) && Math.abs(Date.now() - Date.parse(run)) < 3 * 3600 * 1e3;
    const today2 = fresh ? run : kyivDay();
    const stamp = nowIso();
    await db.batch([
      [`INSERT OR IGNORE INTO b2b_catalog (product_id, name, brand_id) SELECT product_id, COALESCE(name, ''), brand_id FROM an_products WHERE product_id > 0`, []],
      [`UPDATE b2b_catalog SET brand_id = (SELECT a.brand_id FROM an_products a WHERE a.product_id = b2b_catalog.product_id)
        WHERE EXISTS (SELECT 1 FROM an_products a WHERE a.product_id = b2b_catalog.product_id AND a.brand_id IS NOT b2b_catalog.brand_id)`, []]
    ]);
    const todo = await db.all(
      `SELECT product_id, rrp, brand_id FROM b2b_catalog WHERE hidden = 0 AND checked_at < ? AND (manual = 1 OR brand_id IN (SELECT brand_id FROM b2b_margins))
       ORDER BY checked_at LIMIT ?`,
      [today2, BATCH * BATCHES_PER_CALL]
    );
    const at = nowIso();
    let changed = 0;
    const items = [];
    const names = todo.length ? await brandNames() : /* @__PURE__ */ new Map();
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const j = await call(fetchFn, s.lpcrm_subdomain, s.lpcrm_key, "getProduct", { product_id: part.map((x) => x.product_id).join(","), status_ignore: "1" });
      if (j.status !== "ok" && !j.data) throw fail(502, `LP-CRM (\u043A\u0430\u0442\u0430\u043B\u043E\u0433): ${j.message || "\u043D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u0442\u043E\u0432\u0430\u0440\u0438"}`);
      const got = new Map(collectProducts(j.data).map((p) => [parseInt(p.id ?? p.product_id, 10), p]));
      const st = [];
      for (const r of part) {
        const p = got.get(r.product_id);
        if (!p) {
          st.push([`UPDATE b2b_catalog SET checked_at = ? WHERE product_id = ?`, [stamp, r.product_id]]);
          continue;
        }
        const rrp = round2(num3(p.price));
        const vendor = p.vendor && p.vendor !== "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" ? p.vendor : "";
        st.push([
          `UPDATE b2b_catalog SET name = ?, article = ?, rrp = ?, image = ?, checked_at = ? WHERE product_id = ?`,
          [String(p.name || p.title || "").trim().slice(0, 300), String(p.article || vendor || p.model || "").slice(0, 60), rrp, findImage(p), stamp, r.product_id]
        ]);
        if (r.rrp > 0 && rrp > 0 && Math.abs(rrp - r.rrp) >= 5e-3) {
          st.push([`INSERT INTO b2b_price_log (at, product_id, old_rrp, new_rrp) VALUES (?, ?, ?, ?)`, [at, r.product_id, r.rrp, rrp]]);
          changed++;
          items.push({ id: r.product_id, name: String(p.name || p.title || "").trim().slice(0, 300), brand: names.get(r.brand_id) || "\u0406\u043D\u0448\u0456", old: r.rrp, now: rrp });
        }
      }
      await db.batch(st);
    }
    await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_catalog_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [at]);
    const state = await catalogState(today2);
    return c.json({ ok: true, checked: todo.length, changed, items, left: state.stale, lastSync: at });
  });
  app.get("/api/b2b/brands", async (c) => {
    need(c, "b2b.admin");
    return c.json([...await brandNames()].map(([id, name]) => ({ id, name })));
  });
  async function myPartner(c) {
    need(c, "b2b.partner");
    const u = c.get("user");
    const p = u.partner_id ? await db.get(`SELECT * FROM b2b_partners WHERE id = ? AND active = 1`, [u.partner_id]) : null;
    if (!p) throw fail(403, "\u041A\u0430\u0431\u0456\u043D\u0435\u0442 \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E. \u0417\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u0434\u043E \u0432\u0430\u0448\u043E\u0433\u043E \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430.");
    return p;
  }
  app.get("/api/b2b/p/team", async (c) => {
    const p = await myPartner(c);
    need(c, "b2b.team");
    await services.notify?.fillTgNames?.(5).catch(() => 0);
    const rows = await db.all(`SELECT * FROM users WHERE partner_id = ? AND role = 'partner' ORDER BY active DESC, login`, [p.id]);
    return c.json({ users: rows.map(teamRow), roles: PARTNER_ROLES, max: MAX_TEAM, me: c.get("user").id });
  });
  app.post("/api/b2b/p/team", async (c) => {
    const p = await myPartner(c);
    need(c, "b2b.team");
    const r = await addTeamUser(c, p, await c.req.json(), `partner:${actorName(c)}`);
    await services.notify?.sendText({ admins: true }, `\u{1F465} \u041F\u0430\u0440\u0442\u043D\u0435\u0440 \xAB${p.name}\xBB \u0434\u043E\u0434\u0430\u0432 \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 <b>${r.login}</b> (${PARTNER_ROLES[r.role]}) \u2014 \u0434\u043E\u0434\u0430\u0432 ${actorName(c)}.`).catch(() => 0);
    return c.json({ id: r.id });
  });
  app.put("/api/b2b/p/team/:uid", async (c) => {
    const p = await myPartner(c);
    need(c, "b2b.team");
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND partner_id = ? AND role = 'partner'`, [c.req.param("uid"), p.id]);
    if (!u) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    await updateTeamUser(c, p, u, await c.req.json(), { byPartner: true });
    return c.json({ ok: true });
  });
  app.get("/api/b2b/p/me", async (c) => {
    const p = await myPartner(c);
    return c.json({ partner: { id: p.id, name: p.name } });
  });
  app.get("/api/b2b/p/catalog", async (c) => {
    const p = await myPartner(c);
    const [rows, names, cats] = await Promise.all([
      db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.image, c.brand_id, m.margin, COALESCE(a.cat_manual, a.category_id, 0) AS cat
        FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id LEFT JOIN an_products a ON a.product_id = c.product_id
        WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`, [p.id]),
      brandNames(),
      db.all(`SELECT id, name FROM an_categories`).catch(() => [])
    ]);
    const freq = new Map((await db.all(
      `SELECT i.product_id, COUNT(DISTINCT o.id) AS n, SUM(i.qty) AS q FROM b2b_orders o JOIN b2b_order_items i ON i.order_id = o.id
       WHERE o.partner_id = ? AND o.kind IN ('supply', 'client') AND o.status NOT IN ('cancelled', 'open', 'draft') GROUP BY i.product_id`,
      [p.id]
    )).map((r) => [r.product_id, r]));
    const catName = new Map(cats.map((x) => [x.id, x.name]));
    const brands = [...new Map(rows.map((r) => [r.brand_id, { id: r.brand_id, name: names.get(r.brand_id) || "\u0406\u043D\u0448\u0456", margin: r.margin }])).values()].sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const categories = [...rows.reduce((m, r) => m.set(r.cat, (m.get(r.cat) || 0) + 1), /* @__PURE__ */ new Map())].map(([id, n]) => ({ id, name: catName.get(id) || "\u0406\u043D\u0448\u0435", n })).sort((a, b) => a.name.localeCompare(b.name, "uk"));
    return c.json({
      partner: { id: p.id, name: p.name },
      brands,
      categories,
      // Спершу те, що партнер замовляє найчастіше (далі — за назвою).
      products: rows.map((r) => ({
        id: r.product_id,
        name: r.name,
        article: r.article,
        image: r.image,
        brand_id: r.brand_id,
        cat: r.cat,
        brand: names.get(r.brand_id) || "\u0406\u043D\u0448\u0456",
        rrp: r.rrp,
        price: partnerPrice(r.rrp, r.margin),
        margin: r.margin,
        ordered: freq.get(r.product_id)?.n || 0,
        ordered_qty: freq.get(r.product_id)?.q || 0
      })).sort((a, b) => b.ordered - a.ordered || b.ordered_qty - a.ordered_qty)
    });
  });
  const hooks = {};
  const orders = mountB2bOrders(app, { db, services, myPartner, partnerPrice, onCleanup, hooks });
  mountB2bClients(app, { db, fetchFn, myPartner, orders, hooks });
  mountB2bEdits(app, { db, orders, hooks, myPartner, partnerPrice });
  const tgdocs = mountB2bTgDocs(app, { db, services, orders, hooks });
  const pay = mountB2bPay(app, { db, services, orders, hooks });
  onCleanup(() => hooks.cleanup?.());
  mountB2bStats(app, { db, myPartner });
  mountB2bPrices(app, { db, services, partnerPrice });
  app.post("/api/b2b/partners/:id/tg-group", async (c) => {
    need(c, "b2b.admin");
    const p = await getPartner(c.req.param("id"));
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, "Telegram-\u0431\u043E\u0442\u0430 \u0449\u0435 \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E (\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u2192 Telegram).");
    const code = randomToken(6);
    await db.run(`UPDATE b2b_partners SET tg_group_code = ? WHERE id = ?`, [`${code}|${Date.now() + 30 * 6e4}`, p.id]);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete("/api/b2b/partners/:id/tg-group", async (c) => {
    need(c, "b2b.admin");
    const p = await getPartner(c.req.param("id"));
    await db.run(`UPDATE b2b_partners SET tg_group = '', tg_group_title = '', tg_group_code = '' WHERE id = ?`, [p.id]);
    await audit(c, p.id, `\u0432\u0456\u0434\u0432'\u044F\u0437\u0430\u043D\u043E Telegram-\u0433\u0440\u0443\u043F\u0443 \xAB${p.tg_group_title || p.tg_group}\xBB`);
    return c.json({ ok: true });
  });
  const tgGroupLink = async (code, chat, title) => {
    const p = await db.get(`SELECT id, name, tg_group_code FROM b2b_partners WHERE tg_group_code LIKE ? AND COALESCE(deleted_at, '') = ''`, [`${code}|%`]);
    if (!p || (Number(p.tg_group_code.split("|")[1]) || 0) < Date.now()) return tgdocs.linkSpecialGroup(code, chat, title);
    await db.run(`UPDATE b2b_partners SET tg_group = ?, tg_group_title = ?, tg_group_code = '' WHERE id = ?`, [chat, String(title).slice(0, 120), p.id]);
    await logAudit(db, { user: null, kind: "b2b", refId: p.id, action: `\u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E Telegram-\u0433\u0440\u0443\u043F\u0443 \xAB${title}\xBB`, changes: [] }).catch(() => 0);
    return `\u2705 \u0413\u0440\u0443\u043F\u0443 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E \u0434\u043E \u043F\u0430\u0440\u0442\u043D\u0435\u0440\u0430 <b>${String(p.name).replace(/[<>&]/g, "")}</b>. \u0421\u044E\u0434\u0438 \u043D\u0430\u0434\u0445\u043E\u0434\u0438\u0442\u0438\u043C\u0443\u0442\u044C \u0437\u0430\u043A\u0443\u043F\u0456\u0432\u043B\u0456, \u0440\u0430\u0445\u0443\u043D\u043A\u0438 \u0439 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0456 (\u0444\u0430\u0439\u043B\u0430\u043C\u0438) \u0442\u0430 \u043E\u043F\u043B\u0430\u0442\u0438.`;
  };
  const tgGroupMoved = (from, to) => db.run(`UPDATE b2b_partners SET tg_group = ? WHERE tg_group = ?`, [to, from]);
  const tgGroupLeft = (chat) => db.run(`UPDATE b2b_partners SET tg_group = '', tg_group_title = '' WHERE tg_group = ?`, [chat]);
  return { partnerPrice, tgGroupLink, tgGroupMoved, tgGroupLeft, tgPrivate: tgdocs.tgPrivate, tgCallback: tgdocs.tgCallback, tgGroupMessage: tgdocs.tgGroupMessage, onPayments: pay.onPayments, payInfo: pay.payInfo };
}

// src/modules/payments/index.js
var ODB_BASE = "https://iban.opendatabot.ua";
var kindOf2 = (code) => /^\d{10}$/.test(String(code || "").trim()) ? "fop" : "company";
var kyivParts = (d) => {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return f.format(d).replace(" ", "T");
};
function normDate(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`;
  m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return `${m[1]}T${m[2] || "00"}:${m[3] || "00"}:${m[4] || "00"}`;
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime())) return kyivParts(d);
  return kyivParts(/* @__PURE__ */ new Date());
}
async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(key, body) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
var sameHex = (a, b) => {
  a = String(a || "").trim().toLowerCase();
  b = String(b || "").trim().toLowerCase();
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function txRow(item) {
  const t = item?.transaction || {};
  const type = String(t.transactionType || "").toLowerCase();
  const amount = round2(num(t.amount));
  if (type === "debit" || !type && amount <= 0 || amount <= 0) return null;
  const date = normDate(t.date);
  const id = await sha1([String(t.date ?? ""), amount.toFixed(2), t.iban || "", t.counterpartyAcc || t.counterpartyEdrpou || "", t.purpose || ""].join("|"));
  const possible = (Array.isArray(item.possibleInvoices) ? item.possibleInvoices : []).map((p) => typeof p === "object" && p !== null ? p.invoice?.id ?? p.id : p).filter((v) => v != null && typeof v !== "object" && String(v) !== "").map(String);
  return {
    id,
    date,
    amount,
    currency: String(t.currency || "UAH").toUpperCase(),
    purpose: String(t.purpose || ""),
    iban: String(t.iban || "").replace(/\s/g, "").toUpperCase(),
    payer_name: String(t.counterpartyName || "").trim(),
    payer_code: String(t.counterpartyEdrpou || "").trim(),
    payer_acc: String(t.counterpartyAcc || "").replace(/\s/g, "").toUpperCase(),
    our_code: String(t.edrpou || "").trim(),
    invoice_id: item.invoice?.id ? String(item.invoice.id) : null,
    possible: JSON.stringify(possible.slice(0, 10)),
    config_id: item.autoclientConfigId ? String(item.autoclientConfigId) : ""
  };
}
function pickName(x) {
  for (const k of ["alias", "name", "recipient", "recipientName", "receiver", "receiverName", "title", "companyName", "ownerName", "fullName", "counterpartyName"]) {
    const v = x?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object" && typeof v.name === "string" && v.name.trim()) return v.name.trim();
  }
  for (const [k, v] of Object.entries(x || {})) {
    if (["id", "iban", "code", "fileId", "logoUrl"].includes(k) || typeof v !== "string") continue;
    if (/[A-Za-zА-Яа-яІіЇїЄєҐґ]{2,}\s+[A-Za-zА-Яа-яІіЇїЄєҐґ«"]/.test(v) && !/^https?:/.test(v)) return v.trim();
  }
  return "";
}
var BANKS = { 305299: "\u041F\u0440\u0438\u0432\u0430\u0442", 322001: "\u043C\u043E\u043D\u043E", 300465: "\u041E\u0449\u0430\u0434", 300528: "\u041E\u0422\u041F", 380805: "\u0420\u0430\u0439\u0444\u0444\u0430\u0439\u0437\u0435\u043D", 334851: "\u041F\u0423\u041C\u0411", 351005: "\u0423\u043A\u0440\u0421\u0438\u0431\u0431\u0430\u043D\u043A", 320478: "\u0423\u043A\u0440\u0433\u0430\u0437\u0431\u0430\u043D\u043A", 322313: "\u0423\u043A\u0440\u0435\u043A\u0441\u0456\u043C\u0431\u0430\u043D\u043A", 380775: "\u041A\u0440\u0435\u0434\u0456 \u0410\u0433\u0440\u0456\u043A\u043E\u043B\u044C", 339500: "\u0413\u043B\u043E\u0431\u0443\u0441", 325365: "\u041A\u0440\u0435\u0434\u043E\u0431\u0430\u043D\u043A", 336503: "\u0406\u0434\u0435\u044F \u0411\u0430\u043D\u043A", 320649: "Sense", 380838: "\u041F\u0456\u0432\u0434\u0435\u043D\u043D\u0438\u0439", 313849: "\u0422\u0430\u0441\u043A\u043E\u043C\u0431\u0430\u043D\u043A" };
var bankOf = (iban) => BANKS[String(iban || "").replace(/\s/g, "").slice(4, 10)] || "";
var ACC = `COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, ''), a.iban)`;
function mountOdb(app, { db, fetchFn, services = {}, base = ODB_BASE, notify = async () => 0, onTx = async () => 0 }) {
  const settings = () => loadSettings(db);
  const putSetting2 = (key, value) => putSetting(db, key, value);
  async function creds() {
    const s = await settings();
    if (!s.odb_key || !s.odb_name) throw fail(400, "Opendatabot \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E: \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043B\u044E\u0447 \u0456 \u043D\u0430\u0437\u0432\u0443 \u043A\u043B\u0456\u0454\u043D\u0442\u0430 \u0432 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u0440\u0430\u0445\u0443\u043D\u043A\u0456\u0432\xBB.");
    return { key: s.odb_key, name: s.odb_name, s };
  }
  async function odb(cr, method, path, body) {
    const r = await fetchFn(`${base}${path}`, {
      method,
      headers: { "x-client-key": cr.key, "x-client-name": cr.name, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : void 0
    });
    let j = null;
    try {
      j = await r.json();
    } catch {
    }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw fail(400, "Opendatabot: \u043D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043A\u043B\u044E\u0447 \u0430\u0431\u043E \u043D\u0430\u0437\u0432\u0430 \u043A\u043B\u0456\u0454\u043D\u0442\u0430.");
      if (r.status === 402) throw fail(400, "Opendatabot: \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u0440\u0438\u0437\u0443\u043F\u0438\u043D\u0435\u043D\u043E \u0447\u0435\u0440\u0435\u0437 \u043D\u0435\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u0456 \u0440\u0430\u0445\u0443\u043D\u043A\u0438 \u0441\u0435\u0440\u0432\u0456\u0441\u0443.");
      const det = Array.isArray(j?.errors) ? j.errors.map((e) => e.message || e.field).join("; ") : "";
      throw fail(502, `Opendatabot: ${j?.message || `\u043F\u043E\u043C\u0438\u043B\u043A\u0430 ${r.status}`}${det ? ` (${det})` : ""}`);
    }
    return j || {};
  }
  async function addSeenAccounts() {
    await db.batch([
      [`UPDATE odb_accounts SET code = (SELECT MAX(t.our_code) FROM odb_tx t WHERE t.iban = odb_accounts.iban AND t.our_code != '')
        WHERE code = '' AND EXISTS (SELECT 1 FROM odb_tx t WHERE t.iban = odb_accounts.iban AND t.our_code != '')`, []],
      [`INSERT OR IGNORE INTO odb_accounts (id, iban, code, alias, kind, enabled, sort, seen)
        SELECT 'iban:' || t.iban, t.iban, COALESCE(MAX(t.our_code), ''), '', CASE WHEN length(MAX(t.our_code)) = 8 THEN 'company' ELSE 'fop' END, 0, 1000, 1
        FROM odb_tx t WHERE t.iban != '' AND t.iban NOT IN (SELECT iban FROM odb_accounts) GROUP BY t.iban`, []],
      [`UPDATE odb_accounts SET kind = CASE WHEN length(code) = 8 THEN 'company' ELSE 'fop' END WHERE code != ''`, []]
    ]);
  }
  async function fillNames() {
    const empty = await db.all(`SELECT id, iban, code, alias FROM odb_accounts WHERE name = ''`);
    if (!empty.length) return;
    const known = await db.all(`SELECT full_name, short_name, ipn, iban FROM inv_fops UNION ALL SELECT full_name, short_name, ipn, iban FROM fops`);
    const norm = (x) => String(x || "").replace(/\s/g, "").toUpperCase();
    const st = [];
    for (const a of empty) {
      const f = known.find((k) => norm(k.iban) === a.iban) || (a.code ? known.find((k) => String(k.ipn || "").trim() === a.code) : null);
      let base2 = a.alias || (f ? (f.full_name || f.short_name || "").trim() : "");
      if (f && !/^(ФОП|ТОВ|ПП)(\s|$)/i.test(base2) && kindOf2(a.code) === "fop") base2 = `\u0424\u041E\u041F ${base2}`;
      if (!base2) continue;
      const bank = bankOf(a.iban);
      st.push([`UPDATE odb_accounts SET name = ? WHERE id = ?`, [bank && !base2.toLowerCase().includes(bank.toLowerCase()) ? `${base2} (${bank})` : base2, a.id]]);
    }
    await db.batch(st);
  }
  app.get("/api/odb/accounts", async (c) => {
    need(c, "docs.edit");
    if (c.req.query("refresh")) {
      need(c, "api");
      const cr = await creds();
      const j = await odb(cr, "GET", "/api/iban-settings");
      const list = Array.isArray(j.ibanSettings) ? j.ibanSettings : Array.isArray(j) ? j : [];
      const ids = list.map((x) => String(x.id));
      const st = list.map((x, i) => [
        `INSERT INTO odb_accounts (id, iban, code, alias, kind, sort) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET iban = excluded.iban, code = excluded.code, alias = excluded.alias, kind = excluded.kind, sort = excluded.sort`,
        [String(x.id), String(x.iban || "").replace(/\s/g, "").toUpperCase(), String(x.code || ""), pickName(x), kindOf2(x.code), i]
      ]);
      st.push([`UPDATE odb_accounts SET id = 'iban:' || iban, enabled = 0, seen = 1 WHERE id NOT LIKE 'iban:%' AND id NOT IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM odb_accounts b WHERE b.id = 'iban:' || odb_accounts.iban)`, [JSON.stringify(ids)]]);
      st.push([`DELETE FROM odb_accounts WHERE id NOT LIKE 'iban:%' AND id NOT IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]]);
      st.push([`UPDATE odb_accounts SET name = '' WHERE name_manual = 0 AND alias != '' AND id NOT LIKE 'iban:%'`, []]);
      await db.batch(st);
      await addSeenAccounts();
    }
    await fillNames();
    await db.run(`UPDATE inv_fops SET short_name = (SELECT COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, '')) FROM odb_accounts a WHERE a.id = inv_fops.odb_id)
      WHERE odb_id != '' AND short_name = '\u0424\u041E\u041F ' || ipn
        AND EXISTS (SELECT 1 FROM odb_accounts a WHERE a.id = inv_fops.odb_id AND COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, '')) IS NOT NULL)`);
    const rows = await db.all(`SELECT id, iban, code, alias AS odb_alias, name, ${ACC} AS alias, kind, enabled, seen FROM odb_accounts a ORDER BY seen, sort, ${ACC}`);
    const s = await settings();
    return c.json({ accounts: rows.map((r) => ({ ...r, bank: bankOf(r.iban) })), connected: Boolean(s.odb_key && s.odb_name) });
  });
  app.put("/api/odb/accounts/:id", async (c) => {
    need(c, "api");
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [c.req.param("id")]);
    if (!acc) throw fail(404, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u2014 \u043E\u043D\u043E\u0432\u0456\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A.");
    const b = await c.req.json();
    if (b.name !== void 0) {
      const name = String(b.name || "").trim().slice(0, 120);
      const oldName = acc.name || acc.alias || "";
      await db.run(`UPDATE odb_accounts SET name = ?, name_manual = ? WHERE id = ?`, [name, name ? 1 : 0, acc.id]);
      if (name) await db.run(`UPDATE inv_fops SET short_name = ? WHERE odb_id = ? AND (short_name = ? OR short_name = ? OR short_name = '')`, [name, acc.id, oldName, `\u0424\u041E\u041F ${acc.code}`]);
      if (!acc.id.startsWith("iban:") && name) {
        const cr = await creds().catch(() => null);
        if (cr) await odb(cr, "PUT", `/api/iban-settings/${encodeURIComponent(acc.id)}`, { alias: name }).catch(() => {
        });
      }
      if (!name) await fillNames();
      return c.json({ ok: true });
    }
    if (acc.id.startsWith("iban:")) throw fail(400, "\u0426\u0435\u0439 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u043B\u0438\u0448\u0435 \u0432 \xAB\u0410\u0432\u0442\u043E\u043A\u043B\u0456\u0454\u043D\u0442\u0456\xBB. \u0429\u043E\u0431 \u0441\u0442\u0432\u043E\u0440\u044E\u0432\u0430\u0442\u0438 \u043D\u0430 \u043D\u044C\u043E\u0433\u043E \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F, \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0414\u043E\u0434\u0430\u0442\u0438 \u0432 Opendatabot\xBB.");
    const on = b.enabled ? 1 : 0;
    const st = [[`UPDATE odb_accounts SET enabled = ? WHERE id = ?`, [on, acc.id]]];
    if (acc.kind === "fop") {
      if (on) {
        const ex = await db.get(`SELECT id FROM inv_fops WHERE odb_id = ? OR REPLACE(UPPER(iban), ' ', '') = ?`, [acc.id, acc.iban]);
        if (ex) st.push([`UPDATE inv_fops SET odb_id = ?, active = 1, short_name = CASE WHEN short_name = ? AND ? != '' THEN ? ELSE short_name END WHERE id = ?`, [acc.id, `\u0424\u041E\u041F ${acc.code}`, acc.name || acc.alias || "", acc.name || acc.alias || "", ex.id]]);
        else st.push([`INSERT INTO inv_fops (short_name, full_name, ipn, iban, odb_id, active) VALUES (?, '', ?, ?, ?, 1)`, [acc.name || acc.alias || `\u0424\u041E\u041F ${acc.code}`, acc.code, acc.iban, acc.id]]);
      } else {
        st.push([`UPDATE inv_fops SET active = 0 WHERE odb_id = ?`, [acc.id]]);
      }
    }
    await db.batch(st);
    return c.json({ ok: true });
  });
  app.post("/api/odb/accounts/:id/register", async (c) => {
    need(c, "api");
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [c.req.param("id")]);
    if (!acc || !acc.id.startsWith("iban:")) throw fail(400, "\u0426\u0435\u0439 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0443\u0436\u0435 \u0454 \u0432 Opendatabot.");
    const b = await c.req.json().catch(() => ({}));
    const code = String(b.code || acc.code || "").trim();
    if (!/^(\d{8}|\d{10})$/.test(code)) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0434: \u0404\u0414\u0420\u041F\u041E\u0423 (8 \u0446\u0438\u0444\u0440) \u0434\u043B\u044F \u0422\u041E\u0412/\u041F\u041F \u0430\u0431\u043E \u0420\u041D\u041E\u041A\u041F\u041F (10 \u0446\u0438\u0444\u0440) \u0434\u043B\u044F \u0424\u041E\u041F.");
    const cr = await creds();
    const r = await odb(cr, "POST", "/api/iban-settings", { iban: acc.iban, code, alias: acc.name || "" });
    if (!r.id) throw fail(502, "Opendatabot \u043D\u0435 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u0456\u0434\u0435\u043D\u0442\u0438\u0444\u0456\u043A\u0430\u0442\u043E\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443.");
    await db.batch([
      [`DELETE FROM odb_accounts WHERE id = ?`, [acc.id]],
      [
        `INSERT OR REPLACE INTO odb_accounts (id, iban, code, alias, kind, enabled, sort, seen, name) VALUES (?, ?, ?, ?, ?, 0, 500, 0, ?)`,
        [String(r.id), acc.iban, code, String(r.alias || ""), kindOf2(code), acc.name || ""]
      ]
    ]);
    return c.json({ ok: true, id: String(r.id) });
  });
  const LINK_COLS = `l.id, l.odb_id, l.number, l.order_ref, l.account_id, l.amount, l.purpose, l.client, l.url, l.page, l.status, l.paid_amount, l.paid_at,
    l.rahunok_id, l.created_at, l.created_by_id, l.created_by, ${ACC} AS account_alias, a.kind AS account_kind, a.iban AS account_iban`;
  const nextManualNumber = () => takeRahunokNumber(db);
  async function createLink(c, { account_id, amount, number, order_ref = "", client = "", purpose = "", force = false, rahunok_id = null }) {
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [account_id]);
    if (!acc || !acc.enabled) throw fail(400, "\u0426\u0435\u0439 \u0440\u0430\u0445\u0443\u043D\u043E\u043A \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E \u0434\u043B\u044F \u0444\u043E\u0440\u043C\u0443\u0432\u0430\u043D\u043D\u044F \u2014 \u0443\u0432\u0456\u043C\u043A\u043D\u0456\u0442\u044C \u0439\u043E\u0433\u043E \u0432 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u0440\u0430\u0445\u0443\u043D\u043A\u0456\u0432.");
    const sum = round2(num(amount));
    if (!(sum > 0)) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u0441\u0443\u043C\u0443 \u0431\u0456\u043B\u044C\u0448\u0435 0.");
    order_ref = String(order_ref || "").trim();
    if (!force && (order_ref || number)) {
      const dup = await db.get(
        `SELECT ${LINK_COLS} FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id
         WHERE l.account_id = ? AND l.status IN ('pending', 'partial', 'check') AND (${order_ref ? "l.order_ref = ?" : "l.number = ?"})
         ORDER BY l.id DESC LIMIT 1`,
        [account_id, order_ref || String(number)]
      );
      if (dup) return { duplicate: dup };
    }
    const no = String(number || order_ref || await nextManualNumber());
    const text = String(purpose || "").trim() || `\u041E\u043F\u043B\u0430\u0442\u0430 \u0437\u0430 \u0440\u0430\u0445\u0443\u043D\u043A\u043E\u043C \u2116 ${no}`;
    const cr = await creds();
    const j = await odb(cr, "POST", "/api/invoice", { ibanSettingId: acc.id, amount: sum.toFixed(2), purpose: text, responseMode: "json" });
    if (!j.id) throw fail(502, "Opendatabot \u043D\u0435 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u043D\u043E\u043C\u0435\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443.");
    const page = `${base}/invoice/${encodeURIComponent(j.id)}`;
    const me = c.get("user");
    const r = await db.run(
      `INSERT INTO pay_links (odb_id, number, order_ref, account_id, amount, purpose, client, url, page, qr, status, rahunok_id, created_at, created_by_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [String(j.id), no, order_ref, acc.id, sum, text, String(client || "").trim(), String(j.url || page), page, String(j.qrcode || ""), rahunok_id, nowIso(), me.id, userName(c)]
    );
    const link = await db.get(`SELECT ${LINK_COLS}, l.qr FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id WHERE l.id = ?`, [r.lastId]);
    return { link };
  }
  async function linkForRahunok(c, data) {
    const fop = await db.get(`SELECT odb_id, iban FROM inv_fops WHERE id = ?`, [data.fop.id]);
    const acc = await db.get(
      `SELECT * FROM odb_accounts WHERE enabled = 1 AND kind = 'fop' AND (id = ? OR iban = ?) LIMIT 1`,
      [fop?.odb_id || "", String(fop?.iban || "").replace(/\s/g, "").toUpperCase()]
    );
    if (!acc) throw fail(400, "\u0414\u043B\u044F \u0446\u044C\u043E\u0433\u043E \u0424\u041E\u041F \u043D\u0435\u043C\u0430\u0454 \u0443\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u043E\u0433\u043E \u0440\u0430\u0445\u0443\u043D\u043A\u0443 Opendatabot \u2014 QR-\u043A\u043E\u0434 \u0434\u043E\u0434\u0430\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430.");
    const ex = await db.get(
      `SELECT id, page, qr, amount, status FROM pay_links WHERE account_id = ? AND number = ? AND status NOT IN ('closed') ORDER BY id DESC LIMIT 1`,
      [acc.id, data.number]
    );
    if (ex && Math.abs(ex.amount - data.total) < 5e-3 && ex.qr) return { link_id: ex.id, page: ex.page, qr: ex.qr };
    if (ex && ["pending", "check"].includes(ex.status)) await db.run(`UPDATE pay_links SET status = 'closed' WHERE id = ?`, [ex.id]);
    const { link } = await createLink(c, {
      account_id: acc.id,
      amount: data.total,
      number: data.number,
      order_ref: data.source === "crm" ? data.number : "",
      client: data.client?.name || "",
      force: true
    });
    return { link_id: link.id, page: link.page, qr: link.qr };
  }
  app.get("/api/odb/links", async (c) => {
    need(c, "docs.edit");
    const f = c.req.query("filter") || "all";
    const mine = c.req.query("mine") === "1";
    const q = String(c.req.query("q") || "").trim();
    const where = [];
    const params = [];
    if (f === "unpaid") where.push(`l.status IN ('pending', 'partial', 'check')`);
    if (f === "paid") where.push(`l.status IN ('paid', 'over', 'manual')`);
    if (mine) {
      where.push("l.created_by_id = ?");
      params.push(c.get("user").id);
    }
    if (q) {
      where.push("(l.number LIKE ? OR l.order_ref LIKE ? OR l.client LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = await db.all(
      `SELECT ${LINK_COLS} FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT 300`,
      params
    );
    const s = await settings();
    return c.json({ links: rows, lastSync: s.odb_sync_at || "", nextNumber: peekRahunokNumber(s) });
  });
  app.get("/api/odb/links/:id", async (c) => {
    need(c, "docs.edit");
    const link = await db.get(`SELECT ${LINK_COLS}, l.qr FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id WHERE l.id = ?`, [c.req.param("id")]);
    if (!link) throw fail(404, "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const payments = await db.all(`SELECT id, date, amount, currency, purpose, payer_name, payer_code, manual FROM odb_tx WHERE link_id = ? ORDER BY date`, [link.id]);
    const possible = await db.all(
      `SELECT t.id, t.date, t.amount, t.purpose, t.payer_name FROM odb_tx_possible p JOIN odb_tx t ON t.id = p.tx_id
       WHERE p.odb_id = ? AND t.link_id IS NULL ORDER BY t.date DESC LIMIT 10`,
      [link.odb_id]
    );
    return c.json({ link, payments, possible });
  });
  app.post("/api/odb/links", async (c) => {
    need(c, "docs.edit");
    const b = await c.req.json();
    const r = await createLink(c, {
      account_id: String(b.account_id || ""),
      amount: b.amount,
      order_ref: b.order_ref,
      client: b.client,
      purpose: b.purpose,
      force: Boolean(b.force)
    });
    return c.json(r);
  });
  app.post("/api/odb/links/:id/close", async (c) => {
    need(c, "docs.edit");
    await db.run(`UPDATE pay_links SET status = 'closed' WHERE id = ? AND status IN ('pending', 'check')`, [c.req.param("id")]);
    return c.json({ ok: true });
  });
  app.post("/api/odb/links/:id/paid", async (c) => {
    need(c, "users");
    const link = await db.get(`SELECT * FROM pay_links WHERE id = ?`, [c.req.param("id")]);
    if (!link) throw fail(404, "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    const cr = await creds();
    await odb(cr, "POST", `/api/invoice/${encodeURIComponent(link.odb_id)}/paid`);
    await db.run(`UPDATE pay_links SET status = 'manual', paid_at = COALESCE(paid_at, ?) WHERE id = ?`, [nowIso(), link.id]);
    return c.json({ ok: true });
  });
  async function saveTx(items) {
    const rows = (await Promise.all(items.map(txRow))).filter(Boolean);
    if (!rows.length) return { rows, fresh: 0, freshRows: [], changedIds: [] };
    const known = new Map((await db.all(
      `SELECT id, invoice_id, possible, our_code FROM odb_tx WHERE id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(rows.map((r) => r.id))]
    )).map((r) => [r.id, r]));
    const changed = rows.filter((r) => {
      const k = known.get(r.id);
      return !k || r.invoice_id && !k.invoice_id || r.possible !== k.possible || r.our_code && r.our_code !== k.our_code;
    });
    const freshRows = rows.filter((r) => !known.has(r.id));
    if (!changed.length) return { rows, fresh: 0, freshRows, changedIds: [] };
    const now = nowIso();
    const st = [];
    for (const r of changed) {
      st.push([
        `INSERT INTO odb_tx (id, date, amount, currency, purpose, iban, payer_name, payer_code, payer_acc, invoice_id, possible, config_id, our_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET invoice_id = COALESCE(odb_tx.invoice_id, excluded.invoice_id), possible = excluded.possible, our_code = excluded.our_code`,
        [r.id, r.date, r.amount, r.currency, r.purpose, r.iban, r.payer_name, r.payer_code, r.payer_acc, r.invoice_id, r.possible, r.config_id, r.our_code, now]
      ]);
      if (known.has(r.id)) st.push([`DELETE FROM odb_tx_possible WHERE tx_id = ?`, [r.id]]);
      for (const odbId of JSON.parse(r.possible)) st.push([`INSERT OR IGNORE INTO odb_tx_possible (tx_id, odb_id) VALUES (?, ?)`, [r.id, odbId]]);
    }
    await db.batch(st);
    await addSeenIbans(changed);
    return { rows, fresh: freshRows.length, freshRows, changedIds: changed.map((r) => r.id) };
  }
  async function addSeenIbans(rows) {
    const by = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (!r.iban) continue;
      const cur = by.get(r.iban) || "";
      by.set(r.iban, r.our_code > cur ? r.our_code : cur);
    }
    if (!by.size) return;
    const st = [];
    for (const [iban, code] of by) {
      const kind = String(code).length === 8 ? "company" : "fop";
      if (code) st.push([`UPDATE odb_accounts SET code = ?, kind = ? WHERE iban = ? AND code = ''`, [code, kind, iban]]);
      st.push([`INSERT INTO odb_accounts (id, iban, code, alias, kind, enabled, sort, seen)
        SELECT ?, ?, ?, '', ?, 0, 1000, 1 WHERE NOT EXISTS (SELECT 1 FROM odb_accounts WHERE iban = ?)`, [`iban:${iban}`, iban, code, kind, iban]]);
    }
    await db.batch(st);
  }
  async function relink({ txIds = [], linkIds = [] } = {}) {
    if (!txIds.length && !linkIds.length) return [];
    const tx = JSON.stringify(txIds);
    if (txIds.length) {
      await db.run(`UPDATE odb_tx SET link_id = (SELECT p.id FROM pay_links p WHERE p.odb_id = odb_tx.invoice_id)
        WHERE id IN (SELECT value FROM json_each(?)) AND +link_id IS NULL AND manual = 0 AND invoice_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM pay_links p WHERE p.odb_id = odb_tx.invoice_id)`, [tx]);
    }
    const targets = txIds.length ? await db.all(
      `SELECT l.id, l.status FROM pay_links l WHERE l.status NOT IN ('closed', 'manual') AND (
         l.id IN (SELECT value FROM json_each(?))
         OR l.id IN (SELECT link_id FROM odb_tx WHERE id IN (SELECT value FROM json_each(?)) AND link_id IS NOT NULL)
         OR l.odb_id IN (SELECT invoice_id FROM odb_tx WHERE id IN (SELECT value FROM json_each(?)) AND invoice_id IS NOT NULL)
         OR l.odb_id IN (SELECT odb_id FROM odb_tx_possible WHERE tx_id IN (SELECT value FROM json_each(?))))`,
      [JSON.stringify(linkIds), tx, tx, tx]
    ) : await db.all(`SELECT id, status FROM pay_links WHERE status NOT IN ('closed', 'manual') AND id IN (SELECT value FROM json_each(?))`, [JSON.stringify(linkIds)]);
    if (!targets.length) return [];
    const ids = JSON.stringify(targets.map((t) => t.id));
    await db.batch([
      [`UPDATE pay_links SET
          paid_amount = (SELECT COALESCE(SUM(t.amount), 0) FROM odb_tx t WHERE t.link_id = pay_links.id),
          paid_at = COALESCE((SELECT MAX(t.date) FROM odb_tx t WHERE t.link_id = pay_links.id), CASE WHEN odb_paid = 1 THEN paid_at END)
        WHERE id IN (SELECT value FROM json_each(?))`, [ids]],
      [`UPDATE pay_links SET status = CASE
          WHEN paid_amount > amount + 1 THEN 'over'
          WHEN paid_amount >= amount - 1 AND paid_amount > 0 THEN 'paid'
          WHEN paid_amount > 0 THEN 'partial'
          WHEN odb_paid = 1 THEN 'paid'
          WHEN EXISTS (SELECT 1 FROM odb_tx_possible p JOIN odb_tx t ON t.id = p.tx_id WHERE p.odb_id = pay_links.odb_id AND t.link_id IS NULL) THEN 'check'
          ELSE 'pending' END
        WHERE id IN (SELECT value FROM json_each(?))`, [ids]]
    ]);
    const after = new Map((await db.all(`SELECT id, status FROM pay_links WHERE id IN (SELECT value FROM json_each(?))`, [ids])).map((r) => [r.id, r.status]));
    return targets.filter((r) => ["paid", "over", "partial"].includes(after.get(r.id)) && after.get(r.id) !== r.status).map((r) => r.id);
  }
  app.post("/api/odb/hook", async (c) => {
    const raw2 = await c.req.text();
    const s = await settings();
    if (!s.odb_key) throw fail(400, "Opendatabot \u043D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E.");
    const sig = c.req.header("signature") || c.req.header("x-signature") || "";
    if (!sameHex(sig, await hmacHex(s.odb_key, raw2))) throw fail(401, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043F\u0456\u0434\u043F\u0438\u0441.");
    let body;
    try {
      body = JSON.parse(raw2);
    } catch {
      throw fail(400, "\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 JSON.");
    }
    const { fresh, freshRows, changedIds } = await saveTx([body]);
    const paid = await relink({ txIds: changedIds });
    await putSetting2("odb_hook_at", nowIso());
    await notify({ linkIds: paid, freshRows }).catch(() => 0);
    await onTx(freshRows.map((r) => r.id), new URL(c.req.url).origin).catch(() => 0);
    return c.json({ ok: true, fresh, paid: paid.length });
  });
  const PAGE2 = 100;
  async function pullNew(cr) {
    let added = 0;
    const newRows = [];
    const changedIds = [];
    for (let p = 0; p < 5; p++) {
      const j = await odb(cr, "GET", `/api/transactions?limit=${PAGE2}&offset=${p * PAGE2}`);
      const items = Array.isArray(j.items) ? j.items : [];
      const { fresh, freshRows, changedIds: ch } = await saveTx(items);
      added += fresh;
      newRows.push(...freshRows);
      changedIds.push(...ch);
      if (items.length < PAGE2 || fresh === 0) break;
    }
    return { added, newRows, changedIds };
  }
  async function refresh(origin = "") {
    const s = await settings();
    if (!s.odb_key || !s.odb_name) return { connected: false };
    const { added, newRows, changedIds } = await pullNew({ key: s.odb_key, name: s.odb_name });
    const paid = await relink({ txIds: changedIds });
    await putSetting2("odb_sync_at", nowIso());
    await notify({ linkIds: paid, freshRows: newRows }).catch(() => 0);
    if (newRows.length) await onTx(newRows.map((r) => r.id), origin).catch(() => 0);
    return { connected: true, added };
  }
  app.post("/api/odb/sync", async (c) => {
    need(c, "docs.edit");
    const b = await c.req.json().catch(() => ({}));
    const s = await settings();
    if (!s.odb_key || !s.odb_name) return c.json({ ok: false, connected: false });
    const last = Date.parse(s.odb_sync_at || "") || 0;
    if (!b.force && Date.now() - last < 4 * 6e4) return c.json({ ok: true, skipped: true, lastSync: s.odb_sync_at, hist: JSON.parse(s.odb_hist || "{}") });
    await putSetting2("odb_sync_at", nowIso());
    const cr = { key: s.odb_key, name: s.odb_name };
    const pulled = await pullNew(cr);
    let { added } = pulled;
    const { newRows, changedIds } = pulled;
    let hist = {};
    try {
      hist = JSON.parse(s.odb_hist || "{}");
    } catch {
    }
    if (!s.odb_hist_v2) {
      hist = {};
      await putSetting2("odb_hist_v2", "1");
    }
    if (!hist.done) {
      let off = hist.offset || 0;
      for (let p = 0; p < 3; p++) {
        const j = await odb(cr, "GET", `/api/transactions?limit=${PAGE2}&offset=${off}`);
        const items = Array.isArray(j.items) ? j.items : [];
        const { fresh, changedIds: ch } = await saveTx(items);
        added += fresh;
        changedIds.push(...ch);
        off += items.length;
        hist.total = Number(j.count) || hist.total || 0;
        if (items.length < PAGE2) {
          hist.done = true;
          break;
        }
      }
      hist.offset = off;
      await putSetting2("odb_hist", JSON.stringify(hist));
    }
    const linkIds = [];
    const open = await db.get(`SELECT COUNT(*) AS n FROM pay_links WHERE status IN ('pending', 'check')`);
    if (open?.n) {
      const j = await odb(cr, "GET", `/api/invoices?status=paid&limit=${PAGE2}&offset=0`);
      const paidIds = (Array.isArray(j.items) ? j.items : []).filter((x) => String(x.paymentStatus || "paid") === "paid").map((x) => String(x.id));
      if (paidIds.length) {
        const hit = await db.all(`SELECT id FROM pay_links WHERE odb_paid = 0 AND odb_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(paidIds)]);
        if (hit.length) {
          linkIds.push(...hit.map((r) => r.id));
          await db.run(`UPDATE pay_links SET odb_paid = 1, paid_at = COALESCE(paid_at, ?) WHERE id IN (SELECT value FROM json_each(?))`, [nowIso(), JSON.stringify(linkIds)]);
        }
      }
    }
    const paid = await relink({ txIds: changedIds, linkIds });
    await notify({ linkIds: paid, freshRows: hist.done ? newRows : [] }).catch(() => 0);
    if (hist.done && newRows.length) await onTx(newRows.map((r) => r.id), new URL(c.req.url).origin).catch(() => 0);
    const me = c.get("user");
    const minePaid = paid.length ? await db.all(`SELECT id, number, amount, client FROM pay_links WHERE created_by_id = ? AND id IN (SELECT value FROM json_each(?))`, [me.id, JSON.stringify(paid)]) : [];
    return c.json({ ok: true, added, paid: paid.length, minePaid, hist, lastSync: nowIso() });
  });
  app.get("/api/odb/payments", async (c) => {
    need(c, "docs.edit");
    const tab = c.req.query("tab") === "mine" ? "mine" : "all";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("from") || "") ? c.req.query("from") : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("to") || "") ? c.req.query("to") : "";
    const acc = String(c.req.query("account") || "");
    const only = c.req.query("only") || "";
    const where = [];
    const params = [];
    if (from) {
      where.push("t.date >= ?");
      params.push(`${from}T00:00:00`);
    }
    if (to) {
      where.push("t.date <= ?");
      params.push(`${to}T23:59:59`);
    }
    if (acc) {
      where.push("t.iban = (SELECT iban FROM odb_accounts WHERE id = ?)");
      params.push(acc);
    }
    if (tab === "mine") {
      where.push("l.created_by_id = ?");
      params.push(c.get("user").id);
    }
    if (only === "ours") where.push("t.link_id IS NOT NULL");
    if (only === "check") where.push(`t.link_id IS NULL AND t.possible != '[]'`);
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows, tot, accounts] = await Promise.all([
      db.all(
        `SELECT t.id, t.date, t.amount, t.currency, t.purpose, t.iban, t.payer_name, t.payer_code, t.possible, t.link_id, t.manual,
                l.number AS link_number, l.status AS link_status, l.created_by AS link_author, ${ACC} AS account_alias, a.kind AS account_kind
         FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id LEFT JOIN odb_accounts a ON a.iban = t.iban
         ${w} ORDER BY t.date DESC LIMIT 500`,
        params
      ),
      db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.currency = 'UAH' THEN t.amount END), 0) AS sum FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id ${w}`, params),
      db.all(`SELECT id, ${ACC} AS alias, kind FROM odb_accounts a ORDER BY seen, sort, alias`)
    ]);
    if (can(c.get("user"), "b2b.admin") && services.b2b?.payInfo) {
      const info = await services.b2b.payInfo(rows.filter((r) => !r.link_id).map((r) => r.id));
      for (const r of rows) if (info.has(r.id)) r.b2b = info.get(r.id);
    }
    const s = await settings();
    let hist = {};
    try {
      hist = JSON.parse(s.odb_hist || "{}");
    } catch {
    }
    return c.json({ rows, count: tot?.n || 0, sum: round2(tot?.sum || 0), accounts, lastSync: s.odb_sync_at || "", hookAt: s.odb_hook_at || "", hist, connected: Boolean(s.odb_key && s.odb_name) });
  });
  app.put("/api/odb/payments/:id", async (c) => {
    need(c, "docs.edit");
    const b = await c.req.json();
    const me = c.get("user");
    const admin = can(me, "users");
    const linkId = b.link_id ? parseInt(b.link_id, 10) : null;
    const link = linkId ? await db.get(`SELECT id, created_by_id FROM pay_links WHERE id = ?`, [linkId]) : null;
    if (linkId && !link) throw fail(404, "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (!admin) {
      const tx = await db.get(`SELECT t.link_id, l.created_by_id FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id WHERE t.id = ?`, [c.req.param("id")]);
      if (!tx) throw fail(404, "\u041F\u043B\u0430\u0442\u0456\u0436 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
      const mine = (x) => String(x ?? "") === String(me.id);
      if (link && !mine(link.created_by_id) || tx.link_id && !mine(tx.created_by_id)) {
        throw fail(403, "\u041F\u0440\u0438\u0432\u2019\u044F\u0437\u0443\u0432\u0430\u0442\u0438 \u043F\u043B\u0430\u0442\u0435\u0436\u0456 \u0434\u043E \u0447\u0443\u0436\u0438\u0445 \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u044C \u043C\u043E\u0436\u0443\u0442\u044C \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A \u0456 \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0438.");
      }
    }
    const prev = await db.get(`SELECT link_id FROM odb_tx WHERE id = ?`, [c.req.param("id")]);
    await db.run(`UPDATE odb_tx SET link_id = ?, manual = 1 WHERE id = ?`, [linkId, c.req.param("id")]);
    await relink({ txIds: [c.req.param("id")], linkIds: [linkId, prev?.link_id].filter(Boolean) });
    return c.json({ ok: true });
  });
  const PERSON = "person";
  const payerKey = `CASE WHEN length(t.payer_code) = 10 THEN '${PERSON}' WHEN t.payer_code != '' THEN t.payer_code ELSE 'name:' || t.payer_name END`;
  app.get("/api/odb/stats", async (c) => {
    need(c, "analytics");
    const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "";
    const from = day(c.req.query("from")) || "2000-01-01";
    const to = day(c.req.query("to")) || "2999-12-31";
    const cmpFrom = day(c.req.query("cmpFrom"));
    const cmpTo = day(c.req.query("cmpTo"));
    const group = ["day", "week", "month"].includes(c.req.query("group")) ? c.req.query("group") : "day";
    const accs = String(c.req.query("accounts") || "").split(",").filter(Boolean).slice(0, 40);
    const payer = String(c.req.query("payer") || "");
    const bucket = group === "month" ? `substr(t.date, 1, 7)` : group === "week" ? `date(substr(t.date, 1, 10), 'weekday 0', '-6 days')` : `substr(t.date, 1, 10)`;
    const scope = (f, tt) => {
      const w = [`t.date >= ?`, `t.date <= ?`, `t.currency = 'UAH'`];
      const p = [`${f}T00:00:00`, `${tt}T23:59:59`];
      if (accs.length) {
        w.push(`t.iban IN (SELECT iban FROM odb_accounts WHERE id IN (SELECT value FROM json_each(?)))`);
        p.push(JSON.stringify(accs));
      }
      if (payer) {
        w.push(`${payerKey} = ?`);
        p.push(payer);
      }
      return { w: `WHERE ${w.join(" AND ")}`, p };
    };
    const cur = scope(from, to);
    const prev = cmpFrom && cmpTo ? scope(cmpFrom, cmpTo) : null;
    const q = (sc, sql) => db.all(sql.replace("$W", sc.w), sc.p);
    const [tot, series, byAcc, byPayer, ptot, pseries, pAcc, pPayer, accounts, names, range] = await Promise.all([
      q(cur, `SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount), 0) AS sum FROM odb_tx t $W`),
      q(cur, `SELECT ${bucket} AS k, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY k`),
      q(cur, `SELECT t.iban, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY t.iban`),
      q(cur, `SELECT ${payerKey} AS k, MAX(t.payer_name) AS name, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY sum DESC LIMIT 40`),
      prev ? q(prev, `SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount), 0) AS sum FROM odb_tx t $W`) : null,
      prev ? q(prev, `SELECT ${bucket} AS k, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY k`) : null,
      prev ? q(prev, `SELECT t.iban, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY t.iban`) : null,
      prev ? q(prev, `SELECT ${payerKey} AS k, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k`) : null,
      db.all(`SELECT id, iban, ${ACC} AS alias, kind FROM odb_accounts a ORDER BY seen, sort, alias`),
      db.all(`SELECT code, name FROM odb_payers`),
      db.get(`SELECT MIN(date) AS min, MAX(date) AS max FROM odb_tx`)
    ]);
    const accBy = new Map(accounts.map((a) => [a.iban, a]));
    const nameBy = new Map(names.map((n) => [n.code, n.name]));
    const pA = new Map((pAcc || []).map((r) => [r.iban, r.sum]));
    const pP = new Map((pPayer || []).map((r) => [r.k, r.sum]));
    const s = await settings();
    let hist = {};
    try {
      hist = JSON.parse(s.odb_hist || "{}");
    } catch {
    }
    return c.json({
      group,
      total: { sum: round2(tot[0].sum), cnt: tot[0].cnt, avg: tot[0].cnt ? round2(tot[0].sum / tot[0].cnt) : 0 },
      prevTotal: ptot ? { sum: round2(ptot[0].sum), cnt: ptot[0].cnt, avg: ptot[0].cnt ? round2(ptot[0].sum / ptot[0].cnt) : 0 } : null,
      series: series.map((r) => ({ k: r.k, sum: round2(r.sum), cnt: r.cnt })),
      prevSeries: pseries ? pseries.map((r) => ({ k: r.k, sum: round2(r.sum), cnt: r.cnt })) : null,
      byAccount: byAcc.map((r) => {
        const a = accBy.get(r.iban);
        return { id: a?.id || "", iban: r.iban, name: a?.alias || r.iban || "\u2014", kind: a?.kind || "", sum: round2(r.sum), cnt: r.cnt, prevSum: prev ? round2(pA.get(r.iban) || 0) : null };
      }).sort((x, y) => y.sum - x.sum),
      byPayer: byPayer.map((r) => ({
        key: r.k,
        name: r.k === PERSON ? "\u0424\u0456\u0437\u0438\u0447\u043D\u0456 \u043E\u0441\u043E\u0431\u0438" : nameBy.get(r.k) || r.name || "\u2014",
        auto: r.k === PERSON ? "" : r.name || "",
        code: r.k === PERSON || r.k.startsWith("name:") ? "" : r.k,
        sum: round2(r.sum),
        cnt: r.cnt,
        prevSum: prev ? round2(pP.get(r.k) || 0) : null
      })),
      accounts: accounts.map((a) => ({ id: a.id, name: a.alias, kind: a.kind })),
      range: { min: range?.min?.slice(0, 10) || "", max: range?.max?.slice(0, 10) || "" },
      lastSync: s.odb_sync_at || "",
      hist
    });
  });
  app.put("/api/odb/payers/:code", async (c) => {
    need(c, "analytics");
    const code = c.req.param("code");
    const name = String((await c.req.json()).name || "").trim().slice(0, 120);
    if (!name) await db.run(`DELETE FROM odb_payers WHERE code = ?`, [code]);
    else await db.run(`INSERT INTO odb_payers (code, name) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name`, [code, name]);
    return c.json({ ok: true });
  });
  const TX_COLS = `id, date, amount, currency, purpose, payer_name, payer_code, iban, (SELECT ${ACC} FROM odb_accounts a WHERE a.iban = odb_tx.iban LIMIT 1) AS account`;
  const txs = (ids) => db.all(`SELECT ${TX_COLS} FROM odb_tx WHERE id IN (SELECT value FROM json_each(?)) AND +link_id IS NULL`, [JSON.stringify(ids)]);
  const txByPayer = (code, days = 120) => db.all(
    `SELECT ${TX_COLS} FROM odb_tx WHERE payer_code = ? AND link_id IS NULL AND currency = 'UAH' AND date >= ? ORDER BY date DESC LIMIT 50`,
    [code, new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)]
  );
  return { linkForRahunok, txs, txByPayer, refresh };
}

// src/app.js
function createApp({ db, fetchFn: rawFetch = fetch, maxSubrequests = Infinity, odbBase = ODB_BASE, shared: shared2 = {} }) {
  const app = new Hono3();
  let usedSubrequests = 0;
  const fetchFn = async (...args) => {
    if (++usedSubrequests > maxSubrequests) {
      throw Object.assign(new Error("\u041E\u0431\u0440\u043E\u0431\u043A\u0430 \u0442\u0440\u0438\u0432\u0430\u0454\u2026"), { pending: true });
    }
    return rawFetch(...args);
  };
  app.onError(async (err, c) => {
    if (err.pending) return c.json({ pending: true, message: err.message }, 202);
    if (!err.status) console.error(err);
    if (!err.status || err.status >= 500) {
      const u = c.get("user");
      await services.errlog?.log(err, { path: c.req.path, user: u?.name || u?.login || "" });
    }
    return c.json({ error: err.message || String(err), ...err.extra || {} }, err.status || 500);
  });
  const cleanupTasks = [];
  const onCleanup = (fn) => cleanupTasks.push(fn);
  const tickTasks = [];
  const onTick = (fn) => tickTasks.push(fn);
  async function runCleanup(c = null) {
    for (const t of tickTasks) {
      try {
        t(c);
      } catch {
      }
    }
    if (Date.now() - (shared2.lastCleanup || 0) < 60 * 60 * 1e3) return;
    shared2.lastCleanup = Date.now();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1e3).toISOString();
    const claim = await db.run(
      `INSERT INTO settings (key, value) VALUES ('cleanup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
      [(/* @__PURE__ */ new Date()).toISOString(), hourAgo]
    );
    if (!claim.changes) return;
    const s = await loadSettings(db);
    const days = Math.max(1, Number(s.retention_days) || 7);
    const border = new Date(Date.now() - days * 864e5).toISOString();
    for (const task of cleanupTasks) await task(border);
  }
  const services = {};
  const ctx = { db, fetchFn, services, onCleanup, onTick, runCleanup, shared: shared2 };
  mountAuth(app, ctx);
  mountRefs(app, ctx);
  services.nakladni = mountNakladni(app, ctx);
  mountAdmin(app, ctx);
  services.errlog = mountErrLog(app, ctx);
  services.b2b = mountB2b(app, ctx);
  mountRahunky(app, ctx);
  mountAnalytics(app, ctx);
  services.notify = mountTg(app, ctx);
  services.payments = mountOdb(app, { ...ctx, base: odbBase, notify: (...a) => services.notify.notify(...a), onTx: (ids, origin) => services.b2b?.onPayments?.(ids, origin) });
  return app;
}

// src/modules/auth/schema.js
var schema2 = {
  name: "auth",
  version: 3,
  tables: [
    `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
    `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
    // Вихід користувача / чистка старих сесій — без перегляду всієї таблиці.
    `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_created ON sessions (created_at)`
  ],
  columns: [
    ["users", "crm_logins", "TEXT DEFAULT ''"],
    ["users", "failed_logins", "INTEGER DEFAULT 0"],
    ["users", "locked_until", "TEXT DEFAULT ''"],
    // Перемикач аналітики (керує власник): NULL — як у ролі, 0 — вимкнено, 1 — увімкнено.
    ["users", "an_access", "INTEGER"],
    // Користувач-партнер (роль partner) — до якої компанії-партнера належить.
    ["users", "partner_id", "INTEGER"]
  ],
  // Індекс на колонку, додану ALTER TABLE, — після неї.
  async seed(db) {
    await db.run(`CREATE INDEX IF NOT EXISTS users_partner ON users (partner_id)`);
  }
};

// src/modules/notify/schema.js
var schema3 = {
  name: "notify",
  version: 2,
  tables: [],
  columns: [
    ["users", "tg_chat_id", "TEXT DEFAULT ''"],
    ["users", "tg_code", "TEXT DEFAULT ''"],
    ["users", "tg_all_links", "INTEGER DEFAULT 0"],
    ["users", "tg_all_tx", "INTEGER DEFAULT 0"],
    // Який акаунт Telegram підключено (ім'я та @username) і коли.
    ["users", "tg_name", "TEXT DEFAULT ''"],
    ["users", "tg_linked_at", "TEXT DEFAULT ''"]
  ]
};

// src/modules/refs/schema.js
var SEED_FOPS = [
  { key: "agvg", short_name: "\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0412.\u0413." },
  { key: "agam", short_name: "\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C.", full_name: "\u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410\u0440\u043A\u0430\u0434\u0456\u0439 \u041C\u0438\u0445\u0430\u0439\u043B\u043E\u0432\u0438\u0447" },
  { key: "agdm", short_name: "\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", full_name: "\u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414\u0430\u043D\u0456\u0435\u043B\u0430 \u041C\u0438\u0445\u0430\u0439\u043B\u0456\u0432\u043D\u0430" },
  { key: "lupuvf", short_name: "\u0424\u041E\u041F \u041B\u0443\u043F\u0443 \u0412.\u0424.", full_name: "\u041B\u0443\u043F\u0443 \u0412\u0456\u0440\u0430 \u0424\u0456\u043B\u0430\u0440\u0435\u0442\u0456\u0432\u043D\u0430" },
  { key: "lupumg", short_name: "\u0424\u041E\u041F \u041B\u0443\u043F\u0443 \u041C.\u0413.", full_name: "\u041B\u0443\u043F\u0443 \u041C\u0438\u0445\u0430\u0439\u043B\u043E \u0413\u0435\u043E\u0440\u0433\u0456\u0439\u043E\u0432\u0438\u0447" },
  { key: "evds", short_name: "\u0424\u041E\u041F \u0404\u0432\u043F\u0440\u0430\u043A\u0441\u0456\u043D \u0414.\u0421.", full_name: "\u0404\u0432\u043F\u0440\u0430\u043A\u0441\u0456\u043D \u0414\u0430\u043D\u0438\u043B\u043E \u0421\u0435\u0440\u0433\u0456\u0439\u043E\u0432\u0438\u0447" }
];
var SEED_OFFICES = [
  ["4", "\u0424\u0435\u0439\u0441\u0431\u0443\u043A", "agvg"],
  ["5", "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438", null],
  ["6", "\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", "agvg"],
  ["7", "\u0414\u0440\u043E\u043F\u0448\u0438\u043F\u0456\u043D\u0433", null],
  ["8", "\u0422\u0456\u043A\u0422\u043E\u043A", null],
  ["9", "\u0412\u0456\u0434\u0434\u0456\u043B \u041C\u0430\u0440\u043A\u0435\u0442\u0438\u043D\u0433\u0443", null],
  ["11", "\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C / \u0424\u041E\u041F \u041B\u0423\u041F\u0423 \u0412\u0406\u0420\u0410", "lupuvf"],
  ["12", "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438 / \u0424\u041E\u041F \u041B\u0423\u041F\u0423 \u0412.\u0424.", "lupuvf"],
  ["13", "Rozetka(ecovent) / \u0424\u041E\u041F \u041B\u0423\u041F\u0423 \u041C.\u0413.", "lupumg"],
  ["14", "Rozetka(oneday) / \u0424\u041E\u041F \u041B\u0423\u041F\u0423 \u0412.\u0424.", "lupuvf"],
  ["17", "\u0424\u0435\u0439\u0441\u0431\u0443\u043A / \u0424\u041E\u041F \u041B\u0423\u041F\u0423 \u0412\u0406\u0420\u0410", "lupuvf"],
  ["18", "Amsterdam / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C", "agam"],
  ["19", "\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C", "agam"],
  ["20", "Prom(Arca) / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C.", "agam"],
  ["21", "Epicentr(Ecovent) / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C.", "agam"],
  ["22", "Ecovent-Expert / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", "agdm"],
  ["23", "Epicentr(Amsterdam) / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", "agdm"],
  ["24", "Prom(Amsterdam) / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", "agdm"],
  ["25", "iHunt / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", "agdm"],
  ["26", "\u0421\u0435\u0440\u0432\u0456\u0441\u043D\u0438\u0439 \u0432\u0456\u0434\u0434\u0456\u043B", null],
  ["27", "B2B", null],
  ["28", "\u0422\u041E\u0412 \xAB\u0415\u041A\u041E\u0412\u0415\u041D\u0422-\u0414\u0418\u0421\u0422\u0420\u0418\u0411'\u042E\u0428\u041D\xBB", null],
  ["29", "\u0424\u041E\u041F \u0404\u0432\u043F\u0440\u0430\u043A\u0441\u0456\u043D \u0414\u0430\u043D\u0438\u043B\u043E \u0421\u0435\u0440\u0433\u0456\u0439\u043E\u0432\u0438\u0447", "evds"]
];
var SEED_TEMPLATES = [
  {
    name: "\u0412\u0438\u0434\u0430\u0442\u043A\u043E\u0432\u0430 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430 (\u043A\u043B\u0430\u0441\u0438\u0447\u043D\u0430)",
    layout: "classic",
    options: {
      title: "\u0412\u0438\u0434\u0430\u0442\u043A\u043E\u0432\u0430 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u0430",
      accent: "#1f2937",
      showArticle: true,
      showUnit: true,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: ""
    }
  },
  {
    name: "\u0422\u043E\u0432\u0430\u0440\u043D\u0438\u0439 \u0447\u0435\u043A (\u043A\u043E\u043C\u043F\u0430\u043A\u0442\u043D\u0438\u0439)",
    layout: "compact",
    options: {
      title: "\u0422\u043E\u0432\u0430\u0440\u043D\u0438\u0439 \u0447\u0435\u043A",
      accent: "#111827",
      showArticle: false,
      showUnit: false,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: "\u0414\u044F\u043A\u0443\u0454\u043C\u043E \u0437\u0430 \u043F\u043E\u043A\u0443\u043F\u043A\u0443!"
    }
  },
  {
    name: "\u0411\u0440\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u0430 (\u0437 \u043B\u043E\u0433\u043E\u0442\u0438\u043F\u043E\u043C \u0456 \u043A\u043E\u043B\u044C\u043E\u0440\u043E\u043C)",
    layout: "branded",
    options: {
      title: "\u041D\u0430\u043A\u043B\u0430\u0434\u043D\u0430",
      accent: "#0f766e",
      showArticle: true,
      showUnit: true,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: "\u0413\u0430\u0440\u0430\u043D\u0442\u0456\u044F \u0442\u0430 \u043F\u043E\u0432\u0435\u0440\u043D\u0435\u043D\u043D\u044F \u2014 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u043D\u043E \u0434\u043E \u0417\u0430\u043A\u043E\u043D\u0443 \u0423\u043A\u0440\u0430\u0457\u043D\u0438 \xAB\u041F\u0440\u043E \u0437\u0430\u0445\u0438\u0441\u0442 \u043F\u0440\u0430\u0432 \u0441\u043F\u043E\u0436\u0438\u0432\u0430\u0447\u0456\u0432\xBB. \u041F\u043E\u0432\u0435\u0440\u043D\u0435\u043D\u043D\u044F \u0442\u043E\u0432\u0430\u0440\u0443 \u043D\u0430\u043B\u0435\u0436\u043D\u043E\u0457 \u044F\u043A\u043E\u0441\u0442\u0456 \u043F\u0440\u043E\u0442\u044F\u0433\u043E\u043C 14 \u0434\u043D\u0456\u0432."
    }
  }
];
async function seedChannels(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'channels_seeded'`);
  if (done) return;
  const offices = await db.all(`SELECT name, fop_id FROM offices WHERE fop_id IS NOT NULL`);
  const plainNames = new Set((await db.all(`SELECT name FROM offices`)).map((o) => o.name.trim().toLowerCase()));
  const st = [];
  for (const o of offices) {
    const parts = String(o.name).split(" / ");
    if (parts.length < 2) continue;
    const ch = parts[0].trim();
    if (!ch || plainNames.has(ch.toLowerCase())) continue;
    st.push([`INSERT INTO channels (name, fop_id) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`, [ch, o.fop_id]]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('channels_seeded', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
var FOP_FULL_NAMES = [
  ["\u0424\u041E\u041F \u0404\u0432\u043F\u0440\u0430\u043A\u0441\u0456\u043D \u0414.\u0421.", "\u0404\u0432\u043F\u0440\u0430\u043A\u0441\u0456\u043D \u0414\u0430\u043D\u0438\u043B\u043E \u0421\u0435\u0440\u0433\u0456\u0439\u043E\u0432\u0438\u0447"],
  ["\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C.", "\u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410\u0440\u043A\u0430\u0434\u0456\u0439 \u041C\u0438\u0445\u0430\u0439\u043B\u043E\u0432\u0438\u0447"],
  ["\u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414.\u041C.", "\u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0414\u0430\u043D\u0456\u0435\u043B\u0430 \u041C\u0438\u0445\u0430\u0439\u043B\u0456\u0432\u043D\u0430"],
  ["\u0424\u041E\u041F \u041B\u0443\u043F\u0443 \u0412.\u0424.", "\u041B\u0443\u043F\u0443 \u0412\u0456\u0440\u0430 \u0424\u0456\u043B\u0430\u0440\u0435\u0442\u0456\u0432\u043D\u0430"],
  ["\u0424\u041E\u041F \u041B\u0443\u043F\u0443 \u041C.\u0413.", "\u041B\u0443\u043F\u0443 \u041C\u0438\u0445\u0430\u0439\u043B\u043E \u0413\u0435\u043E\u0440\u0433\u0456\u0439\u043E\u0432\u0438\u0447"]
];
async function fillFopNames(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'fop_names_v1'`);
  if (done) return;
  await db.batch([
    ...FOP_FULL_NAMES.map(([short, full]) => [`UPDATE fops SET full_name = ? WHERE short_name = ? AND (full_name = '' OR full_name IS NULL OR full_name LIKE '\u0424\u041E\u041F %')`, [full, short]]),
    [`INSERT INTO settings (key, value) VALUES ('fop_names_v1', '1') ON CONFLICT(key) DO NOTHING`, []]
  ]);
}
async function seedNew(db) {
  const st = [];
  SEED_TEMPLATES.forEach((t, i) => st.push([`INSERT INTO templates (id, name, layout, options) VALUES (?, ?, ?, ?)`, [i + 1, t.name, t.layout, JSON.stringify(t.options)]]));
  const idByKey = {};
  SEED_FOPS.forEach((f, i) => {
    idByKey[f.key] = i + 1;
    st.push([`INSERT INTO fops (id, short_name, full_name, template_id) VALUES (?, ?, ?, 1)`, [i + 1, f.short_name, f.full_name || ""]]);
  });
  for (const [id, name, key] of SEED_OFFICES) {
    st.push([`INSERT INTO offices (office_id, name, fop_id) VALUES (?, ?, ?)`, [id, name, key ? idByKey[key] : null]]);
  }
  const defaults = {
    lpcrm_subdomain: "ihunt",
    lpcrm_key: "",
    default_fop_id: "",
    checkbox_enabled: "0",
    checkbox_search_days: "7",
    lpcrm_search_days: "30",
    seller_note: ""
  };
  for (const [k, v] of Object.entries(defaults)) st.push([`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]]);
  st.push([`INSERT INTO settings (key, value) VALUES ('seeded', '1')`, []]);
  await db.batch(st);
}
var schema4 = {
  name: "refs",
  version: 1,
  tables: [
    `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'classic',
    options TEXT NOT NULL DEFAULT '{}'
  )`,
    `CREATE TABLE IF NOT EXISTS fops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    ipn TEXT DEFAULT '',
    address TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    bank TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    extra TEXT DEFAULT '',
    template_id INTEGER,
    logo TEXT DEFAULT '',
    signature TEXT DEFAULT '',
    stamp TEXT DEFAULT '',
    checkbox_license TEXT DEFAULT '',
    checkbox_login TEXT DEFAULT '',
    checkbox_password TEXT DEFAULT '',
    checkbox_pin TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  )`,
    `CREATE TABLE IF NOT EXISTS offices (
    office_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    fop_id INTEGER
  )`,
    `CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    fop_id INTEGER
  )`
  ],
  columns: [
    ["offices", "seller_text", "TEXT DEFAULT ''"],
    ["channels", "seller_text", "TEXT DEFAULT ''"]
  ],
  // fresh — нова база (ще не засіяна): шаблони, ФОПи, відділи і стартові налаштування одним пакетом.
  async seed(db, { fresh }) {
    if (fresh) await seedNew(db);
    await seedChannels(db);
    await fillFopNames(db);
  }
};

// src/modules/nakladni/schema.js
var schema5 = {
  name: "nakladni",
  version: 2,
  tables: [
    `CREATE TABLE IF NOT EXISTS order_prefs (
    order_id TEXT PRIMARY KEY,
    fop_id INTEGER,
    template_id INTEGER,
    receipt_ref TEXT DEFAULT '',
    edits TEXT DEFAULT '',
    updated_at TEXT
  )`,
    `CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    fop_id INTEGER,
    fop_name TEXT,
    template_id INTEGER,
    total REAL,
    data_hash TEXT,
    data TEXT NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS idx_versions_order ON versions(order_id, id)`,
    `CREATE TABLE IF NOT EXISTS orders_index (
    code TEXT PRIMARY KEY,
    datetime TEXT,
    phone TEXT,
    ttn TEXT,
    bayer_name TEXT,
    data TEXT,
    fetched_at TEXT
  )`,
    // Ключі пошуку замовлення (номер, код, ТТН, телефон «p:» + 9 цифр) — пошук читає кілька рядків, а не весь індекс.
    `CREATE TABLE IF NOT EXISTS order_keys (
    k TEXT NOT NULL,
    code TEXT NOT NULL,
    day TEXT DEFAULT '',
    PRIMARY KEY (k, code)
  )`,
    `CREATE INDEX IF NOT EXISTS order_keys_day ON order_keys (day)`,
    // Для щогодинної чистки за датою — без перегляду всієї таблиці.
    `CREATE INDEX IF NOT EXISTS orders_index_dt ON orders_index (datetime)`,
    `CREATE INDEX IF NOT EXISTS versions_created ON versions (created_at)`,
    `CREATE TABLE IF NOT EXISTS order_alias (
    alias TEXT PRIMARY KEY,
    code TEXT NOT NULL
  )`
  ],
  columns: [
    ["versions", "user_name", "TEXT DEFAULT ''"]
  ],
  // Один раз: ключі пошуку для вже завантажених замовлень.
  async seed(db) {
    await db.batch([
      [`INSERT OR IGNORE INTO order_keys (k, code, day)
        SELECT TRIM(CAST(json_extract(data, '$.id') AS TEXT)), code, substr(datetime, 1, 10) FROM orders_index WHERE json_extract(data, '$.id') IS NOT NULL
        UNION ALL SELECT code, code, substr(datetime, 1, 10) FROM orders_index
        UNION ALL SELECT TRIM(ttn), code, substr(datetime, 1, 10) FROM orders_index WHERE TRIM(ttn) != ''
        UNION ALL SELECT 'p:' || substr(phone, -9), code, substr(datetime, 1, 10) FROM orders_index WHERE length(phone) >= 9`, []]
    ]);
  }
};

// src/modules/rahunky/schema.js
var schema6 = {
  name: "rahunky",
  version: 1,
  tables: [
    `CREATE TABLE IF NOT EXISTS inv_fops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    ipn TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    bank TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    warning_text TEXT DEFAULT '',
    signature TEXT DEFAULT '',
    stamp TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  )`,
    `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    source TEXT NOT NULL,
    order_ref TEXT DEFAULT '',
    fop_id INTEGER,
    fop_name TEXT DEFAULT '',
    client_name TEXT DEFAULT '',
    total REAL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    updated_at TEXT,
    updated_by TEXT DEFAULT ''
  )`
  ],
  columns: [],
  // Налаштування, які з'явилися пізніше, — додаємо, якщо їх ще немає.
  async seed(db) {
    await db.run(`INSERT INTO settings (key, value) VALUES ('rahunok_next_number', '10516') ON CONFLICT(key) DO NOTHING`);
  }
};

// src/modules/payments/schema.js
var schema7 = {
  name: "payments",
  version: 3,
  tables: [
    `CREATE TABLE IF NOT EXISTS odb_accounts (
    id TEXT PRIMARY KEY,
    iban TEXT DEFAULT '',
    code TEXT DEFAULT '',
    alias TEXT DEFAULT '',
    kind TEXT DEFAULT 'fop',
    enabled INTEGER NOT NULL DEFAULT 0,
    sort INTEGER DEFAULT 0
  )`,
    `CREATE TABLE IF NOT EXISTS pay_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odb_id TEXT UNIQUE,
    number TEXT DEFAULT '',
    order_ref TEXT DEFAULT '',
    account_id TEXT,
    amount REAL NOT NULL,
    purpose TEXT DEFAULT '',
    client TEXT DEFAULT '',
    url TEXT DEFAULT '',
    page TEXT DEFAULT '',
    qr TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT,
    odb_paid INTEGER NOT NULL DEFAULT 0,
    rahunok_id INTEGER,
    created_at TEXT,
    created_by_id INTEGER,
    created_by TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS pay_links_status ON pay_links (status)`,
    `CREATE TABLE IF NOT EXISTS odb_tx (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'UAH',
    purpose TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    payer_name TEXT DEFAULT '',
    payer_code TEXT DEFAULT '',
    payer_acc TEXT DEFAULT '',
    invoice_id TEXT,
    possible TEXT NOT NULL DEFAULT '[]',
    link_id INTEGER,
    manual INTEGER NOT NULL DEFAULT 0,
    config_id TEXT DEFAULT '',
    created_at TEXT
  )`,
    `CREATE INDEX IF NOT EXISTS odb_tx_date ON odb_tx (date)`,
    `CREATE INDEX IF NOT EXISTS odb_tx_link ON odb_tx (link_id)`,
    `CREATE TABLE IF NOT EXISTS odb_payers (code TEXT PRIMARY KEY, name TEXT NOT NULL)`,
    // Можливі рахунки платежу окремою таблицею з індексом: статус «перевірити» рахується без перегляду всіх платежів.
    `CREATE TABLE IF NOT EXISTS odb_tx_possible (
    tx_id TEXT NOT NULL,
    odb_id TEXT NOT NULL,
    PRIMARY KEY (tx_id, odb_id)
  )`,
    `CREATE INDEX IF NOT EXISTS odb_tx_possible_odb ON odb_tx_possible (odb_id)`,
    `CREATE INDEX IF NOT EXISTS odb_accounts_iban ON odb_accounts (iban)`
  ],
  columns: [
    ["inv_fops", "odb_id", "TEXT DEFAULT ''"],
    ["odb_accounts", "name", "TEXT DEFAULT ''"],
    ["odb_accounts", "seen", "INTEGER DEFAULT 0"],
    ["odb_accounts", "name_manual", "INTEGER DEFAULT 0"],
    ["odb_tx", "our_code", "TEXT DEFAULT ''"]
  ],
  // Один раз: зіпсовані «[object Object]» прибрати, можливі рахунки перенести в odb_tx_possible.
  async seed(db) {
    await db.batch([
      [`UPDATE odb_tx SET possible = '[]' WHERE possible LIKE '%object Object%'`, []],
      [`CREATE INDEX IF NOT EXISTS odb_tx_payer ON odb_tx (payer_code, date)`, []],
      // оплати закупівель B2B за кодом платника
      [`INSERT OR IGNORE INTO odb_tx_possible (tx_id, odb_id)
        SELECT t.id, j.value FROM odb_tx t, json_each(t.possible) j WHERE t.possible != '[]' AND typeof(j.value) = 'text' AND j.value != ''`, []]
    ]);
  }
};

// src/modules/analytics/schema.js
var MP_SOURCES = [
  ["Rozetka (OneDay)", ["rozetka(oneday)"]],
  ["Rozetka (Ecovent)", ["rozetka(ecovent)"]],
  ["Prom (Arca)", ["prom(arca)"]],
  ["Prom (Amsterdam)", ["prom(amsterdam)"]],
  ["Epicentr (Ecovent)", ["epicentr(ecovent)"]],
  ["Epicentr (Amsterdam)", ["epicentr(amsterdam)"]],
  ["Monomarket", ["monomarket", "mono market", "\u043C\u043E\u043D\u043E \u043C\u0430\u0440\u043A\u0435\u0442", "\u043C\u043E\u043D\u043E\u043C\u0430\u0440\u043A\u0435\u0442"]],
  ["\u0421\u0430\u0439\u0442 iHunt", ["ihunt"]],
  ["\u0421\u0430\u0439\u0442 Ecovent", ["ecovent-expert", "ecovent"]],
  ["\u0421\u0430\u0439\u0442 Amsterdam", ["amsterdam"]],
  ["\u0406\u043D\u0448\u0456", []]
];
var AN_BRANDS = [
  ["iHunt", "ihunt, robot window"],
  ["Evoair", "evoair, humixduo"],
  ["Levoit", "levoit"],
  ["DREO", "dreo"],
  ["Ecovent", "ecovent, decora"],
  ["BSK", "bsk, zephyr, notus"],
  ["Ergovent", "ergovent"],
  ["Dolceclima", "dolceclima"]
];
var SOCIAL_SOURCES = [
  ["\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", ["instagram", "\u0456\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", "\u0438\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", "insta"]],
  ["\u0424\u0435\u0439\u0441\u0431\u0443\u043A", ["facebook", "\u0444\u0435\u0439\u0441\u0431\u0443\u043A", "fb"]],
  ["\u0422\u0456\u043A\u0422\u043E\u043A", ["tiktok", "\u0442\u0456\u043A\u0442\u043E\u043A", "\u0442\u0438\u043A \u0442\u043E\u043A", "tik tok"]]
];
var SOCIAL_NAMES = ["\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", "\u0424\u0435\u0439\u0441\u0431\u0443\u043A", "\u0422\u0456\u043A\u0422\u043E\u043A"];
var AN_SEED = {
  depts: [
    { name: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438", sources: MP_SOURCES.map(([name, values]) => ({ name, values })) },
    { name: "Riteil", sources: [{ name: "Riteil(Rozetka)", values: ["riteil(rozetka)"] }] },
    { name: "\u0421\u043E\u0446\u043C\u0435\u0440\u0435\u0436\u0456", sources: SOCIAL_SOURCES.map(([name, values]) => ({ name, values })) },
    { name: "\u0414\u0440\u043E\u043F\u0448\u0438\u043F\u0456\u043D\u0433", sources: [] },
    { name: "B2B", sources: [] },
    { name: "\u0406\u043D\u0448\u0435", sources: [] }
  ],
  offices: {
    "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438": ["5", "12", "13", "14", "18", "19", "20", "21", "22", "23", "24", "25"],
    "\u0421\u043E\u0446\u043C\u0435\u0440\u0435\u0436\u0456": ["4", "17", "6", "11", "8"],
    "\u0414\u0440\u043E\u043F\u0448\u0438\u043F\u0456\u043D\u0433": ["7"],
    "B2B": ["27", "28"],
    "\u0406\u043D\u0448\u0435": ["9", "26", "29"]
  },
  brands: AN_BRANDS
};
async function seedAnalytics(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'an_seeded'`);
  if (done) return;
  const st = [];
  const deptId = {};
  let sid = 0;
  AN_SEED.depts.forEach((d, i) => {
    const id = i + 1;
    deptId[d.name] = id;
    st.push([`INSERT OR IGNORE INTO an_depts (id, name, sort) VALUES (?, ?, ?)`, [id, d.name, i]]);
    d.sources.forEach((src, j) => {
      sid += 1;
      st.push([`INSERT OR IGNORE INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [sid, id, src.name, j]]);
      for (const v of src.values) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, sid]]);
    });
  });
  for (const [name, list] of Object.entries(AN_SEED.offices)) {
    for (const office of list) st.push([`INSERT OR IGNORE INTO an_office_map (office, dept_id) VALUES (?, ?)`, [office, deptId[name]]]);
  }
  AN_SEED.brands.forEach(([name, kw], i) => st.push([`INSERT OR IGNORE INTO an_brands (id, name, keywords, sort) VALUES (?, ?, ?, ?)`, [i + 1, name, kw, i]]));
  const settings = {
    compare: true,
    // порівняння з попереднім періодом
    deptPriority: "manager",
    // відділ: спершу за менеджером, потім за відділом CRM
    targetBase: "net",
    // таргет від обороту без відмов і повернень
    months: 6,
    okStatuses: [11, 14, 53, 18],
    refuseStatuses: [54, 58]
  };
  st.push([`INSERT INTO settings (key, value) VALUES ('an_settings', ?) ON CONFLICT(key) DO NOTHING`, [JSON.stringify(settings)]]);
  st.push([`INSERT INTO settings (key, value) VALUES ('an_seeded', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
async function upgradeV9(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v9'`)) return;
  const st = [];
  for (const t of await db.all(`SELECT id, options FROM templates`)) {
    let o = {};
    try {
      o = JSON.parse(t.options || "{}");
    } catch {
    }
    if (/Товар отримав/i.test(o.footerText || "")) {
      o.footerText = "";
      st.push([`UPDATE templates SET options = ? WHERE id = ?`, [JSON.stringify(o), t.id]]);
    }
  }
  st.push([`DELETE FROM channels WHERE LOWER(name) LIKE 'techno-expert%'`, []]);
  st.push([`UPDATE offices SET name = TRIM(SUBSTR(name, 17)) WHERE name LIKE 'Techno-Expert / %'`, []]);
  const depts = await db.all(`SELECT id, name FROM an_depts`);
  const sources = await db.all(`SELECT id, dept_id, name FROM an_sources`);
  const byName = (list, n) => list.find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
  let nextDept = Math.max(0, ...depts.map((d) => d.id)) + 1;
  let nextSrc = Math.max(0, ...sources.map((x) => x.id)) + 1;
  let mp = byName(depts, "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438");
  if (!mp) {
    mp = { id: nextDept++, name: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438" };
    st.push([`INSERT INTO an_depts (id, name, sort) VALUES (?, ?, 0)`, [mp.id, mp.name]]);
  }
  const sites = byName(depts, "\u0421\u0430\u0439\u0442\u0438");
  for (const x of sources) {
    const n = x.name.trim().toLowerCase();
    if (["rozetka", "prom", "epicentr"].includes(n) || n.includes("techno")) {
      st.push([`DELETE FROM an_source_map WHERE source_id = ?`, [x.id]]);
      st.push([`DELETE FROM an_sources WHERE id = ?`, [x.id]]);
    }
  }
  st.push([`DELETE FROM an_source_map WHERE value LIKE 'techno-expert%'`, []]);
  MP_SOURCES.forEach(([name, values], i) => {
    let src = byName(sources, name);
    if (!src) {
      src = { id: nextSrc++ };
      st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [src.id, mp.id, name, i]]);
    } else st.push([`UPDATE an_sources SET dept_id = ?, sort = ? WHERE id = ?`, [mp.id, i, src.id]]);
    for (const v of values) st.push([`INSERT OR REPLACE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, src.id]]);
  });
  if (sites) {
    st.push([`UPDATE an_sources SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`UPDATE an_office_map SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`UPDATE an_managers SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`DELETE FROM an_depts WHERE id = ?`, [sites.id]]);
  }
  if (!byName(depts, "Riteil")) {
    const rid = nextDept++;
    const sid = nextSrc++;
    st.push([`INSERT INTO an_depts (id, name, sort) VALUES (?, 'Riteil', 1)`, [rid]]);
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, 'Riteil(Rozetka)', 0)`, [sid, rid]]);
    st.push([`INSERT OR REPLACE INTO an_source_map (value, source_id) VALUES ('riteil(rozetka)', ?)`, [sid]]);
  }
  const brands = await db.all(`SELECT id, name FROM an_brands`);
  let nextBrand = Math.max(0, ...brands.map((b) => b.id)) + 1;
  AN_BRANDS.forEach(([name, kw], i) => {
    const b = byName(brands, name);
    if (b) st.push([`UPDATE an_brands SET name = ?, keywords = ?, sort = ? WHERE id = ?`, [name, kw, i, b.id]]);
    else st.push([`INSERT INTO an_brands (id, name, keywords, sort) VALUES (?, ?, ?, ?)`, [nextBrand++, name, kw, i]]);
  });
  st.push([`UPDATE an_products SET seen = 1`, []]);
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v9', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`);
}
async function upgradeV12(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v12'`)) return;
  const mp = await db.get(`SELECT id FROM an_depts WHERE name = '\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438'`);
  const st = [];
  if (mp && !await db.get(`SELECT id FROM an_sources WHERE dept_id = ? AND name = '\u0406\u043D\u0448\u0456'`, [mp.id])) {
    const next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    const sort = ((await db.get(`SELECT MAX(sort) AS m FROM an_sources WHERE dept_id = ?`, [mp.id]))?.m ?? 0) + 1;
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, '\u0406\u043D\u0448\u0456', ?)`, [next, mp.id, sort]]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v12', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
async function upgradeV11(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v11'`)) return;
  const depts = await db.all(`SELECT id, name FROM an_depts`);
  const old = depts.filter((d) => SOCIAL_NAMES.map((x) => x.toLowerCase()).includes(d.name.trim().toLowerCase()));
  const st = [];
  if (old.length && !depts.some((d) => d.name === "\u0421\u043E\u0446\u043C\u0435\u0440\u0435\u0436\u0456")) {
    const keep = old.find((d) => d.name === "\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C") || old[0];
    st.push([`UPDATE an_depts SET name = '\u0421\u043E\u0446\u043C\u0435\u0440\u0435\u0436\u0456' WHERE id = ?`, [keep.id]]);
    for (const d of old) {
      st.push([`DELETE FROM an_targets WHERE kind = 'dept' AND ref_id = ?`, [d.id]]);
      if (d.id === keep.id) continue;
      st.push([`UPDATE an_sources SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`UPDATE an_office_map SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`UPDATE an_managers SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`DELETE FROM an_depts WHERE id = ?`, [d.id]]);
    }
    const srcs = await db.all(`SELECT id, name FROM an_sources`);
    let next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    SOCIAL_SOURCES.forEach(([name, values], i) => {
      let id = srcs.find((x) => x.name.trim().toLowerCase() === name.toLowerCase())?.id;
      if (id) st.push([`UPDATE an_sources SET dept_id = ? WHERE id = ?`, [keep.id, id]]);
      else {
        id = next++;
        st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [id, keep.id, name, i]]);
      }
      for (const v of values) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, id]]);
    });
    st.push([`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v11', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
async function upgradeV10(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v10'`)) return;
  const mp = await db.get(`SELECT id FROM an_depts WHERE name = '\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438'`);
  const st = [];
  if (mp && !await db.get(`SELECT id FROM an_sources WHERE LOWER(name) = 'monomarket'`)) {
    const next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    const sort = ((await db.get(`SELECT MAX(sort) AS m FROM an_sources WHERE dept_id = ?`, [mp.id]))?.m ?? 0) + 1;
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, 'Monomarket', ?)`, [next, mp.id, sort]]);
    for (const v of ["monomarket", "mono market", "\u043C\u043E\u043D\u043E \u043C\u0430\u0440\u043A\u0435\u0442", "\u043C\u043E\u043D\u043E\u043C\u0430\u0440\u043A\u0435\u0442"]) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, next]]);
    st.push([`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v10', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
var schema8 = {
  name: "analytics",
  version: 5,
  tables: [
    // ---------- Аналітика ----------
    // Замовлення: id = короткий номер LP-CRM (зростає з часом), code = довгий код для API.
    // dept/src обчислюються під час завантаження і при зміні відповідностей (щоб дашборд не робив зайвих JOIN).
    `CREATE TABLE IF NOT EXISTS an_orders (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    day TEXT NOT NULL,
    status INTEGER NOT NULL,
    office TEXT DEFAULT '',
    user TEXT DEFAULT '',
    ch TEXT DEFAULT '',
    site TEXT DEFAULT '',
    utm TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    dept INTEGER NOT NULL DEFAULT 0,
    src INTEGER NOT NULL DEFAULT 0
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS an_orders_code ON an_orders(code)`,
    // Межі id по днях — замість індексу по даті (менше записів у базу).
    `CREATE TABLE IF NOT EXISTS an_day_bounds (day TEXT PRIMARY KEY, min_id INTEGER, max_id INTEGER)`,
    // Рядки товарів: id = id замовлення * 100 + № рядка; amount — сума рядка з урахуванням знижки замовлення.
    `CREATE TABLE IF NOT EXISTS an_items (id INTEGER PRIMARY KEY, product_id INTEGER, qty REAL, amount REAL)`,
    `CREATE TABLE IF NOT EXISTS an_products (product_id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER, brand_id INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS an_categories (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS an_brands (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, keywords TEXT DEFAULT '', sort INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS an_depts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS an_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, dept_id INTEGER, name TEXT NOT NULL, sort INTEGER DEFAULT 0)`,
    // Значення «Поле 1» / сайт / utm_source (у нижньому регістрі) → джерело
    `CREATE TABLE IF NOT EXISTS an_source_map (value TEXT PRIMARY KEY, source_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS an_office_map (office TEXT PRIMARY KEY, dept_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS an_managers (login TEXT PRIMARY KEY, name TEXT DEFAULT '', dept_id INTEGER)`,
    // Таргет на місяць: kind = 'dept' | 'src'
    `CREATE TABLE IF NOT EXISTS an_targets (month TEXT NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, amount REAL NOT NULL, PRIMARY KEY (month, kind, ref_id))`,
    // Збережені відповіді дашборду (поки дані й налаштування не змінились) — менше читань бази.
    `CREATE TABLE IF NOT EXISTS an_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)`,
    // Дублі ТТН у LP-CRM, про які вже сповістили (набір № замовлень) — щоб не повторювати при кожному оновленні.
    `CREATE TABLE IF NOT EXISTS an_ttn_dups (ttn TEXT PRIMARY KEY, codes TEXT NOT NULL, at TEXT NOT NULL)`,
    // Швидка перевірка ТТН нових замовлень (кожні 10 хв): ТТН замовлень за останні дні — окремо від аналітики.
    `CREATE TABLE IF NOT EXISTS an_ttn_recent (code TEXT PRIMARY KEY, ttn TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, user TEXT DEFAULT '', status INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS an_ttn_recent_ttn ON an_ttn_recent(ttn)`,
    `CREATE INDEX IF NOT EXISTS an_ttn_recent_day ON an_ttn_recent(day)`
  ],
  columns: [
    ["an_managers", "depts", "TEXT DEFAULT ''"],
    ["an_products", "brand_manual", "INTEGER"],
    ["an_products", "cat_manual", "INTEGER"],
    ["an_products", "seen", "INTEGER NOT NULL DEFAULT 0"],
    // Служба доставки з LP-CRM (назва); NULL — ще не дозаповнено для старих замовлень.
    ["an_orders", "deliv", "TEXT"],
    // ТТН із замовлення LP-CRM — для перевірки дублів.
    ["an_orders", "ttn", "TEXT DEFAULT ''"]
  ],
  // Нова база: засіяти й позначити старі оновлення виконаними; стара — догнати оновлення v9–v12.
  async seed(db, { fresh }) {
    await seedAnalytics(db);
    await db.run(`CREATE INDEX IF NOT EXISTS an_orders_status ON an_orders(status, id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS an_orders_ttn ON an_orders(ttn) WHERE ttn != ''`);
    if (fresh) {
      await db.batch(["an_v9", "an_v10", "an_v11", "an_v12"].map((k) => [`INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING`, [k]]));
      return;
    }
    await upgradeV9(db);
    await upgradeV10(db);
    await upgradeV11(db);
    await upgradeV12(db);
  }
};

// src/modules/admin/schema.js
var schema9 = {
  name: "admin",
  version: 1,
  tables: [
    // Журнал змін реквізитів ФОП та інших важливих дій: хто, коли, що змінив.
    `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id INTEGER,
    user_name TEXT DEFAULT '',
    kind TEXT NOT NULL,
    ref_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    changes TEXT NOT NULL DEFAULT '[]'
  )`,
    `CREATE INDEX IF NOT EXISTS audit_log_ref ON audit_log (kind, ref_id)`
  ],
  columns: []
};

// src/modules/errlog/schema.js
var schema10 = {
  name: "errlog",
  version: 1,
  tables: [
    `CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    path TEXT DEFAULT '',
    user_name TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS error_log_at ON error_log (at)`
  ],
  columns: []
};

// src/modules/b2b/schema.js
var schema11 = {
  name: "b2b",
  version: 23,
  tables: [
    `CREATE TABLE IF NOT EXISTS b2b_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
    // Увімкнений партнеру бренд і його маржа (%). Немає рядка — бренд партнер не бачить.
    `CREATE TABLE IF NOT EXISTS b2b_margins (
    partner_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    margin REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (partner_id, brand_id)
  )`,
    // Каталог: товари LP-CRM з РРЦ і фото (оновлюється з CRM; бренд — як в аналітиці).
    `CREATE TABLE IF NOT EXISTS b2b_catalog (
    product_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    article TEXT DEFAULT '',
    rrp REAL NOT NULL DEFAULT 0,
    image TEXT DEFAULT '',
    brand_id INTEGER NOT NULL DEFAULT 0,
    manual INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_catalog_brand ON b2b_catalog (brand_id)`,
    `CREATE INDEX IF NOT EXISTS b2b_catalog_checked ON b2b_catalog (checked_at)`,
    // Зміни РРЦ і маржі — для сповіщень партнерам «змінилися ціни».
    `CREATE TABLE IF NOT EXISTS b2b_price_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    old_rrp REAL,
    new_rrp REAL
  )`,
    `CREATE TABLE IF NOT EXISTS b2b_margin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    partner_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    old_margin REAL,
    new_margin REAL
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_price_log_at ON b2b_price_log (at)`,
    `CREATE INDEX IF NOT EXISTS b2b_margin_log_p ON b2b_margin_log (partner_id, at)`,
    // ---------- етап 2: юрособи партнера, закупівлі, файли ----------
    // Юрособи партнера (на кого виставляти рахунок). Використана в замовленнях — лише приховується.
    `CREATE TABLE IF NOT EXISTS b2b_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fop',
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    address TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    vat INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_entities_p ON b2b_entities (partner_id)`,
    `CREATE INDEX IF NOT EXISTS b2b_entities_code ON b2b_entities (code)`,
    // Замовлення партнерів. kind: supply — закупівля в нас; client — замовлення для клієнта партнера (етап 3).
    `CREATE TABLE IF NOT EXISTS b2b_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'supply',
    status TEXT NOT NULL,
    entity_id INTEGER,
    entity TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    comment TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    invoice_date TEXT DEFAULT '',
    waybill_no TEXT DEFAULT '',
    paid_amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT DEFAULT '',
    paid_by TEXT DEFAULT '',
    created_by TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_orders_p ON b2b_orders (partner_id, id)`,
    `CREATE INDEX IF NOT EXISTS b2b_orders_status ON b2b_orders (status)`,
    `CREATE TABLE IF NOT EXISTS b2b_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    article TEXT DEFAULT '',
    qty REAL NOT NULL,
    price REAL NOT NULL,
    rrp REAL NOT NULL DEFAULT 0
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_order_items_o ON b2b_order_items (order_id)`,
    // Історія замовлення: хто, коли, що змінив.
    `CREATE TABLE IF NOT EXISTS b2b_order_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    user_name TEXT DEFAULT '',
    action TEXT NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_order_log_o ON b2b_order_log (order_id)`,
    // Файли (рахунок, накладна, маркування): зберігаються 30 днів; вміст — base64 частинами до 900 КБ (обмеження рядка D1).
    `CREATE TABLE IF NOT EXISTS b2b_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    parts INTEGER NOT NULL DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_files_o ON b2b_files (order_id)`,
    `CREATE INDEX IF NOT EXISTS b2b_files_at ON b2b_files (created_at)`,
    // Документи, надіслані боту особисто (рахунок / накладна): стан підтвердження, що збережено, як скасувати.
    `CREATE TABLE IF NOT EXISTS b2b_tg_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    user_id INTEGER,
    msg_id INTEGER DEFAULT 0,
    file_id TEXT NOT NULL,
    file_uid TEXT DEFAULT '',
    name TEXT DEFAULT '',
    mime TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    parsed TEXT DEFAULT '',
    order_id INTEGER,
    kind TEXT DEFAULT '',
    number TEXT DEFAULT '',
    doc_date TEXT DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending',
    file_row INTEGER,
    prev TEXT DEFAULT '',
    group_msg TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    saved_at TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_tg_docs_chat ON b2b_tg_docs (chat_id, state)`,
    `CREATE INDEX IF NOT EXISTS b2b_tg_docs_at ON b2b_tg_docs (created_at)`,
    `CREATE TABLE IF NOT EXISTS b2b_file_parts (
    file_id INTEGER NOT NULL,
    n INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (file_id, n)
  )`,
    // Платежі Opendatabot за закупівлі: order_id — куди зараховано (порожньо — треба перевірити, candidates — можливі
    // закупівлі); dismissed — адмін відв'язав (Opendatabot помилився), більше не пропонується автоматично.
    `CREATE TABLE IF NOT EXISTS b2b_payments (
    tx_id TEXT PRIMARY KEY,
    order_id INTEGER,
    candidates TEXT NOT NULL DEFAULT '[]',
    dismissed INTEGER NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    date TEXT DEFAULT '',
    payer_name TEXT DEFAULT '',
    payer_code TEXT DEFAULT '',
    purpose TEXT DEFAULT '',
    auto INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_payments_order ON b2b_payments (order_id)`,
    // Види документів партнера до замовлень клієнтів (до 5): «Чек для клієнта», «Накладна для клієнта»…
    // required — без нього замовлення не оформити й не передати в CRM; print — бот надсилає в групу маркувань (для друку).
    `CREATE TABLE IF NOT EXISTS b2b_doc_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 0,
    print INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_doc_types_partner ON b2b_doc_types (partner_id, active)`,
    // Кошик: видалені закупівлі й замовлення клієнтів (знімок для відновлення) і прибрані з закупівлі товари.
    // Хто й коли видалив; партнер бачить свій кошик, видаляють і відновлюють лише наші адміни.
    `CREATE TABLE IF NOT EXISTS b2b_trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    order_id INTEGER,
    partner_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    total REAL DEFAULT 0,
    data TEXT DEFAULT '',
    deleted_by TEXT DEFAULT '',
    by_partner INTEGER DEFAULT 0,
    deleted_at TEXT NOT NULL,
    restored_at TEXT DEFAULT '',
    restored_by TEXT DEFAULT ''
  )`,
    `CREATE INDEX IF NOT EXISTS b2b_trash_partner ON b2b_trash (partner_id, id)`
  ],
  // ---------- етап 3: замовлення для клієнтів партнера ----------
  // supply_id — закупівля, з якої взято товари (порожньо — «без закупівлі»); дані клієнта й ТТН партнера;
  // crm_* — передача в LP-CRM: номер замовлення в CRM (автоматично або вручну), його статус, код, з яким відправили.
  columns: [
    ["b2b_orders", "supply_id", "INTEGER"],
    ["b2b_orders", "client_name", "TEXT DEFAULT ''"],
    ["b2b_orders", "client_phone", "TEXT DEFAULT ''"],
    ["b2b_orders", "ttn", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_id", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_status", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_checked_at", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_sent_at", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_ext", "TEXT DEFAULT ''"],
    // етап 3а: команда партнера (роль у команді, хто додав) і видалені партнери (з замовленнями — в архіві)
    ["users", "partner_role", "TEXT DEFAULT ''"],
    ["users", "added_by", "TEXT DEFAULT ''"],
    ["b2b_partners", "deleted_at", "TEXT DEFAULT ''"],
    // Telegram-група партнера: туди бот дублює закупівлі, рахунки й накладні (файлами), оплату.
    ["b2b_partners", "tg_group", "TEXT DEFAULT ''"],
    ["b2b_partners", "tg_group_title", "TEXT DEFAULT ''"],
    ["b2b_partners", "tg_group_code", "TEXT DEFAULT ''"],
    // Коли партнеру востаннє надіслали зміни цін (кнопка «Надіслати зміни цін»).
    ["b2b_partners", "prices_sent_at", "TEXT DEFAULT ''"],
    // «Фінансові питання»: повідомлення бота із запитом рахунку, повідомлення з рахунком (відповідь на нього — запит
    // накладної), повідомлення із запитом накладної.
    ["b2b_orders", "fin_req_msg", "INTEGER"],
    ["b2b_orders", "fin_inv_msg", "INTEGER"],
    ["b2b_orders", "fin_pay_msg", "INTEGER"],
    ["b2b_orders", "fin_done", "INTEGER DEFAULT 0"],
    // підсумок «закупівлю закрито» вже надіслано
    // Маркування: відбиток файлу й ТТН з етикетки — те саме маркування не можна додати у два замовлення.
    ["b2b_files", "hash", "TEXT DEFAULT ''"],
    ["b2b_files", "ttn", "TEXT DEFAULT ''"],
    // На який наш рахунок прийшла оплата (для коментаря в LP-CRM).
    ["b2b_payments", "account", "TEXT DEFAULT ''"],
    // У групу партнера вже надіслано «усі замовлення закупівлі взято в роботу складом».
    ["b2b_orders", "group_done", "INTEGER DEFAULT 0"],
    // Юрособа партнера за замовчуванням для закупівель.
    ["b2b_partners", "default_entity", "INTEGER"],
    // Спосіб отримання закупівлі: np — відправка клієнтам (замовлення клієнтів), pickup — самовивіз усієї закупівлі.
    ["b2b_orders", "delivery", "TEXT DEFAULT 'np'"],
    // Документ партнера (kind = 'doc'): вид документа з b2b_doc_types.
    ["b2b_files", "doc_type", "INTEGER"],
    // Відстрочка оплати: партнеру — дні й ліміт (задає адмін); закупівлі — умови, дні, строк і останнє нагадування.
    ["b2b_partners", "postpay_days", "INTEGER DEFAULT 0"],
    ["b2b_partners", "postpay_limit", "REAL"],
    ["b2b_orders", "pay_terms", "TEXT DEFAULT 'prepay'"],
    ["b2b_orders", "pay_days", "INTEGER DEFAULT 0"],
    ["b2b_orders", "due_date", "TEXT DEFAULT ''"],
    ["b2b_orders", "due_notified", "TEXT DEFAULT ''"],
    // Пауза партнера: кабінет доступний, нові закупівлі й замовлення — ні; причина показується партнеру.
    ["b2b_partners", "paused", "INTEGER DEFAULT 0"],
    ["b2b_partners", "pause_note", "TEXT DEFAULT ''"],
    // Закупівлю змінено після рахунку: який рахунок (і накладну) переробити; коли — старі файли рахунку замінюються новим.
    ["b2b_orders", "reinvoice", "TEXT DEFAULT ''"],
    ["b2b_orders", "reinvoiced_at", "TEXT DEFAULT ''"],
    // Замовлення клієнта змінив наш менеджер — чекає підтвердження партнера (JSON: як було, що змінено, хто, коли);
    // доки не підтверджено — у LP-CRM не передається. crm_old — номер старого замовлення в CRM, якщо його анульовано.
    ["b2b_orders", "pending", "TEXT DEFAULT ''"],
    ["b2b_orders", "crm_old", "TEXT DEFAULT ''"],
    // документи з групи: звідки (private | fin), на яке повідомлення відповісти, хто надіслав, з чого вибирати
    ["b2b_tg_docs", "source", "TEXT DEFAULT 'private'"],
    ["b2b_tg_docs", "reply_to", "INTEGER"],
    ["b2b_tg_docs", "tg_name", "TEXT DEFAULT ''"],
    ["b2b_tg_docs", "choices", "TEXT DEFAULT ''"],
    // Ліміти партнера (порожньо — типові): відкрита закупівля і всі неоплачені закупівлі.
    ["b2b_partners", "open_limit", "REAL"],
    ["b2b_partners", "unpaid_limit", "REAL"]
  ],
  // Індекси на нові колонки — після ALTER TABLE (у старих базах колонок ще немає, коли створюються таблиці).
  async seed(db) {
    await db.batch([
      [`CREATE INDEX IF NOT EXISTS b2b_orders_supply ON b2b_orders (supply_id)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_kind ON b2b_orders (kind, partner_id, id)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_created ON b2b_orders (created_at)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_files_hash ON b2b_files (hash)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_files_ttn ON b2b_files (ttn)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_ttn ON b2b_orders (ttn)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_payments_payer ON b2b_payments (payer_code)`, []]
    ]);
  }
};

// src/migrate.js
var MODULE_SCHEMAS = [schema, schema2, schema3, schema4, schema5, schema6, schema7, schema8, schema9, schema10, schema11];
var versionKey = (m) => `schema:${m.name}`;
async function migrate(db, modules = MODULE_SCHEMAS) {
  let have = {};
  try {
    have = Object.fromEntries((await db.all(`SELECT key, value FROM settings WHERE key LIKE 'schema:%' OR key = 'seeded'`)).map((r) => [r.key, r.value]));
  } catch {
  }
  const todo = modules.filter((m) => have[versionKey(m)] !== String(m.version));
  if (!todo.length) return;
  const fresh = !have.seeded;
  await db.batch(todo.flatMap((m) => m.tables.map((sql) => [sql, []])));
  const cols = todo.flatMap((m) => m.columns);
  const alters = [];
  for (const table of [...new Set(cols.map((x) => x[0]))]) {
    const existing = new Set((await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name));
    for (const [t, col, type] of cols) if (t === table && !existing.has(col)) alters.push([`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, []]);
  }
  await db.batch(alters);
  for (const m of todo) if (m.seed) await m.seed(db, { fresh });
  await db.batch(todo.map((m) => [
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [versionKey(m), String(m.version)]
  ]));
}

// src/core/db-d1.js
function d1Db(D1) {
  const bind = (sql, params) => {
    const st = D1.prepare(sql);
    const p = (params || []).map((v) => v === void 0 ? null : v);
    return p.length ? st.bind(...p) : st;
  };
  return {
    async all(sql, params) {
      return (await bind(sql, params).all()).results || [];
    },
    async get(sql, params) {
      return await bind(sql, params).first() || null;
    },
    async run(sql, params) {
      const r = await bind(sql, params).run();
      return { changes: Number(r.meta?.changes || 0), lastId: Number(r.meta?.last_row_id || 0) };
    },
    // Кілька змін одним запитом до D1 (транзакція): [[sql, params], ...]
    async batch(list) {
      for (let i = 0; i < list.length; i += 200) {
        await D1.batch(list.slice(i, i + 200).map(([sql, params]) => bind(sql, params)));
      }
    }
  };
}

// src/pages-entry.js
var ready = null;
var shared = {};
async function onRequest(ctx) {
  const { env, request } = ctx;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "\u041D\u0435 \u043F\u0456\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u0431\u0430\u0437\u0443 D1: \u0443 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445 \u043F\u0440\u043E\u0454\u043A\u0442\u0443 Pages \u0434\u043E\u0434\u0430\u0439\u0442\u0435 D1 binding \u0437 \u0456\u043C\u0435\u043D\u0435\u043C DB." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
  setIterations(Number(env.PBKDF2_ITERATIONS) || 1e4);
  const db = d1Db(env.DB);
  if (!ready) ready = migrate(db).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  if (env.OWNER_RESET_PASSWORD && env.OWNER_RESET_PASSWORD.length >= 6) {
    const mark = await db.get(`SELECT value FROM settings WHERE key = 'owner_reset_mark'`);
    const tag = `${env.OWNER_RESET_PASSWORD.length}:${[...env.OWNER_RESET_PASSWORD].reduce((h6, ch) => Math.imul(h6, 31) + ch.charCodeAt(0) >>> 0, 7)}`;
    if (mark?.value !== tag) {
      await resetOwnerPassword(db, env.OWNER_RESET_PASSWORD);
      await db.run(`INSERT INTO settings (key, value) VALUES ('owner_reset_mark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [tag]);
    }
  }
  const fetchFn = env.LPCRM_TEST_URL ? (url, opts) => fetch(String(url).replace(/^https?:\/\/[^/]+\.lp-crm\.biz/, env.LPCRM_TEST_URL), opts) : fetch;
  const app = createApp({ db, fetchFn, maxSubrequests: Number(env.MAX_SUBREQUESTS) || 40, shared });
  return app.fetch(request, env, ctx);
}
export {
  onRequest
};
