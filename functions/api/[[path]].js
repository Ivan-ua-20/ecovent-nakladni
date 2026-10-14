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
        staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
        continue;
      }
      handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [h, trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
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

// src/auth.js
var ROLES = {
  owner: "\u0412\u043B\u0430\u0441\u043D\u0438\u043A",
  admin: "\u0410\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440",
  manager: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440",
  viewer: "\u041F\u0435\u0440\u0435\u0433\u043B\u044F\u0434"
};
var PERMS = {
  owner: ["docs.view", "docs.edit", "refs.edit", "api", "users", "analytics"],
  admin: ["docs.view", "docs.edit", "refs.edit", "api", "users", "analytics"],
  manager: ["docs.view", "docs.edit", "refs.edit"],
  viewer: ["docs.view"]
};
var permsOf = (role) => PERMS[role] || [];
var can = (user, perm) => Boolean(user && permsOf(user.role).includes(perm));
var enc = new TextEncoder();
var toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
var fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
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
  const h = await derive(password, salt, ITER);
  return `pbkdf2$${ITER}$${toHex(salt)}$${h}`;
}
async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !saltHex || !hashHex) return false;
  const h = await derive(password, fromHex(saltHex), Number(iter));
  let diff = h.length ^ hashHex.length;
  for (let i = 0; i < Math.min(h.length, hashHex.length); i++) diff |= h.charCodeAt(i) ^ hashHex.charCodeAt(i);
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
  perms: permsOf(u.role)
} : null;
async function resetOwnerPassword(db, newPassword) {
  const owner = await db.get(`SELECT id, login FROM users WHERE role = 'owner' LIMIT 1`);
  if (!owner) return null;
  await db.run(`UPDATE users SET password_hash = ?, active = 1 WHERE id = ?`, [await hashPassword(newPassword), owner.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [owner.id]);
  return owner.login;
}

// src/schema.js
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
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
  )`,
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
  `CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    fop_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS order_alias (
    alias TEXT PRIMARY KEY,
    code TEXT NOT NULL
  )`
];
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
  ["19", "Techno-Expert / \u0424\u041E\u041F \u0410\u0433\u0430\u0444\u0456\u0446\u0430 \u0410.\u041C", "agam"],
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
      footerText: "\u0422\u043E\u0432\u0430\u0440 \u043E\u0442\u0440\u0438\u043C\u0430\u0432, \u043F\u0440\u0435\u0442\u0435\u043D\u0437\u0456\u0439 \u0449\u043E\u0434\u043E \u043A\u0456\u043B\u044C\u043A\u043E\u0441\u0442\u0456, \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u043D\u043E\u0441\u0442\u0456 \u0442\u0430 \u0437\u043E\u0432\u043D\u0456\u0448\u043D\u044C\u043E\u0433\u043E \u0432\u0438\u0433\u043B\u044F\u0434\u0443 \u043D\u0435 \u043C\u0430\u044E."
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
var ADD_COLUMNS = [
  ["offices", "seller_text", "TEXT DEFAULT ''"],
  ["channels", "seller_text", "TEXT DEFAULT ''"],
  ["versions", "user_name", "TEXT DEFAULT ''"],
  ["users", "failed_logins", "INTEGER DEFAULT 0"],
  ["users", "locked_until", "TEXT DEFAULT ''"]
];
var SCHEMA_VERSION = "8";
var AN_SEED = {
  depts: [
    { name: "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438", sources: [
      { name: "Rozetka", values: ["rozetka(oneday)", "rozetka(ecovent)", "rozetka"] },
      { name: "Prom", values: ["prom(arca)", "prom(amsterdam)", "prom"] },
      { name: "Epicentr", values: ["epicentr(ecovent)", "epicentr(amsterdam)", "epicentr"] }
    ] },
    { name: "\u0421\u0430\u0439\u0442\u0438", sources: [
      { name: "\u0421\u0430\u0439\u0442 iHunt", values: ["ihunt"] },
      { name: "\u0421\u0430\u0439\u0442 Ecovent", values: ["ecovent-expert", "ecovent"] },
      { name: "\u0421\u0430\u0439\u0442 Amsterdam", values: ["amsterdam"] },
      { name: "\u0421\u0430\u0439\u0442 Techno-Expert", values: ["techno-expert"] }
    ] },
    { name: "\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C", sources: [] },
    { name: "\u0424\u0435\u0439\u0441\u0431\u0443\u043A", sources: [] },
    { name: "\u0422\u0456\u043A\u0422\u043E\u043A", sources: [] },
    { name: "\u0414\u0440\u043E\u043F\u0448\u0438\u043F\u0456\u043D\u0433", sources: [] },
    { name: "B2B", sources: [] },
    { name: "\u0406\u043D\u0448\u0435", sources: [] }
  ],
  offices: {
    "\u041C\u0430\u0440\u043A\u0435\u0442\u043F\u043B\u0435\u0439\u0441\u0438": ["5", "12", "13", "14", "20", "21", "23", "24"],
    "\u0421\u0430\u0439\u0442\u0438": ["18", "19", "22", "25"],
    "\u0424\u0435\u0439\u0441\u0431\u0443\u043A": ["4", "17"],
    "\u0406\u043D\u0441\u0442\u0430\u0433\u0440\u0430\u043C": ["6", "11"],
    "\u0422\u0456\u043A\u0422\u043E\u043A": ["8"],
    "\u0414\u0440\u043E\u043F\u0448\u0438\u043F\u0456\u043D\u0433": ["7"],
    "B2B": ["27", "28"],
    "\u0406\u043D\u0448\u0435": ["9", "26", "29"]
  },
  brands: [["iHunt", "ihunt"], ["Evoair", "evoair"], ["Ecovent", "ecovent"]]
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
var LATER_SETTINGS = {
  rahunok_next_number: "10516",
  retention_days: "7"
};
var DEFAULT_WARNING = "\u0423\u0432\u0430\u0433\u0430! \u041E\u043F\u043B\u0430\u0442\u0430 \u0446\u044C\u043E\u0433\u043E \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u043E\u0437\u043D\u0430\u0447\u0430\u0454 \u043F\u043E\u0433\u043E\u0434\u0436\u0435\u043D\u043D\u044F \u0437 \u0443\u043C\u043E\u0432\u0430\u043C\u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0442\u043E\u0432\u0430\u0440\u0456\u0432. \u041F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F \u043F\u0440\u043E \u043E\u043F\u043B\u0430\u0442\u0443 \u0454 \u043E\u0431\u043E\u0432'\u044F\u0437\u043A\u043E\u0432\u0438\u043C, \u0432 \u0456\u043D\u0448\u043E\u043C\u0443 \u0432\u0438\u043F\u0430\u0434\u043A\u0443 \u043D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0443\u0454\u0442\u044C\u0441\u044F \u043D\u0430\u044F\u0432\u043D\u0456\u0441\u0442\u044C \u0442\u043E\u0432\u0430\u0440\u0456\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0456. \u0422\u043E\u0432\u0430\u0440 \u0432\u0456\u0434\u043F\u0443\u0441\u043A\u0430\u0454\u0442\u044C\u0441\u044F \u0437\u0430 \u0444\u0430\u043A\u0442\u043E\u043C \u043D\u0430\u0434\u0445\u043E\u0434\u0436\u0435\u043D\u043D\u044F \u043A\u043E\u0448\u0442\u0456\u0432 \u043D\u0430 \u043F/\u0440 \u041F\u043E\u0441\u0442\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A\u0430, \u0441\u0430\u043C\u043E\u0432\u0438\u0432\u043E\u0437\u043E\u043C, \u0437\u0430 \u043D\u0430\u044F\u0432\u043D\u043E\u0441\u0442\u0456 \u0434\u043E\u0432\u0456\u0440\u0435\u043D\u043E\u0441\u0442\u0456 \u0442\u0430 \u043F\u0430\u0441\u043F\u043E\u0440\u0442\u0430.";
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
async function migrate(db) {
  try {
    const v = await db.get(`SELECT value FROM settings WHERE key = 'schema_version'`);
    if (v?.value === SCHEMA_VERSION) return;
  } catch {
  }
  await migrateFull(db);
  await db.run(`INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [SCHEMA_VERSION]);
}
async function migrateFull(db) {
  await db.batch(SCHEMA.map((sql) => [sql, []]));
  const alters = [];
  for (const table of [...new Set(ADD_COLUMNS.map((x) => x[0]))]) {
    const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name));
    for (const [t, col, type] of ADD_COLUMNS) if (t === table && !have.has(col)) alters.push([`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, []]);
  }
  await db.batch(alters);
  await db.batch(Object.entries(LATER_SETTINGS).map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, [k, v]]));
  const seeded = await db.get(`SELECT value FROM settings WHERE key = 'seeded'`);
  if (seeded) {
    await seedChannels(db);
    await fillFopNames(db);
    await seedAnalytics(db);
    return;
  }
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
  await seedChannels(db);
  await fillFopNames(db);
  await seedAnalytics(db);
}

// src/lpcrm.js
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
  } catch {
    res = await doFetch(`http://${subdomain}.lp-crm.biz/api/${method}.html`);
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
    const h = productCache.get(`${subdomain}|${id}`);
    if (h && Date.now() - h.at < PRODUCT_TTL) cached[id] = h.value;
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

// src/analytics.js
var kyivDay = (d = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(d);
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
var num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
var round2 = (n) => Math.round(n * 100) / 100;
var low = (v) => String(v ?? "").trim().toLowerCase();
var AN_DEFAULTS = {
  compare: true,
  deptPriority: "manager",
  targetBase: "net",
  months: 6,
  okStatuses: [11, 14, 53, 18],
  refuseStatuses: [54, 58]
};
async function loadMaps(db, st) {
  const [offices, managers, sources, brands] = await Promise.all([
    db.all(`SELECT office, dept_id FROM an_office_map`),
    db.all(`SELECT login, dept_id FROM an_managers`),
    db.all(`SELECT value, source_id FROM an_source_map`),
    db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`)
  ]);
  return {
    prio: st.deptPriority,
    office: new Map(offices.map((r) => [String(r.office), r.dept_id])),
    mgr: new Map(managers.filter((r) => r.dept_id).map((r) => [low(r.login), r.dept_id])),
    src: new Map(sources.map((r) => [r.value, r.source_id])),
    brands: brands.map((b) => ({ id: b.id, kws: String(b.keywords || "").split(",").map(low).filter(Boolean) }))
  };
}
var deptOf = (o, m) => m.prio === "office" ? m.office.get(o.office) ?? m.mgr.get(o.user) ?? 0 : m.mgr.get(o.user) ?? m.office.get(o.office) ?? 0;
var srcOf = (o, m) => o.ch && m.src.get(o.ch) || o.site && m.src.get(o.site) || o.utm && m.src.get(o.utm) || 0;
function brandOf(name, brands) {
  const n = low(name);
  for (const b of brands) if (b.kws.some((k) => n.includes(k))) return b.id;
  return 0;
}
async function remap(db, st) {
  const deptMgr = `(SELECT dept_id FROM an_managers m WHERE m.login = an_orders.user AND m.dept_id IS NOT NULL)`;
  const deptOff = `(SELECT dept_id FROM an_office_map f WHERE f.office = an_orders.office)`;
  const dept = st.deptPriority === "office" ? `COALESCE(${deptOff}, ${deptMgr}, 0)` : `COALESCE(${deptMgr}, ${deptOff}, 0)`;
  const one = (col) => `CASE WHEN an_orders.${col} != '' THEN (SELECT source_id FROM an_source_map s WHERE s.value = an_orders.${col}) END`;
  const src = `COALESCE(${one("ch")}, ${one("site")}, ${one("utm")}, 0)`;
  await db.run(`UPDATE an_orders SET dept = ${dept}, src = ${src} WHERE dept IS NOT ${dept} OR src IS NOT ${src}`);
}
async function rebrand(db) {
  const brands = (await db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`)).map((b) => ({ id: b.id, kws: String(b.keywords || "").split(",").map(low).filter(Boolean) }));
  const prods = await db.all(`SELECT product_id, name, brand_id FROM an_products`);
  const upd = [];
  for (const p of prods) {
    const b = brandOf(p.name, brands);
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
    lines
  };
}
async function saveOrders(db, orders, maps) {
  const st = [];
  const bounds = /* @__PURE__ */ new Map();
  for (const o of orders) {
    st.push([
      `INSERT INTO an_orders (id, code, day, status, office, user, ch, site, utm, total, dept, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, day = excluded.day, status = excluded.status, office = excluded.office,
       user = excluded.user, ch = excluded.ch, site = excluded.site, utm = excluded.utm, total = excluded.total, dept = excluded.dept, src = excluded.src`,
      [o.id, o.code, o.day, o.status, o.office, o.user, o.ch, o.site, o.utm, o.total, deptOf(o, maps), srcOf(o, maps)]
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
function mountAnalytics(app, { db, fetchFn, settings, need, fail, nowIso: nowIso2 }) {
  const getSt = async () => {
    const r = await db.get(`SELECT value FROM settings WHERE key = 'an_settings'`);
    let v = {};
    try {
      v = r?.value ? JSON.parse(r.value) : {};
    } catch {
    }
    return { ...AN_DEFAULTS, ...v };
  };
  const putSetting = (key, value) => db.run(
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
  app.use("/api/an/*", async (c, next) => {
    need(c, "analytics");
    return next();
  });
  app.get("/api/an/config", async (c) => {
    const [st, depts, sources, smap, officeMap, managers, brands, offices, statusNames, lastSync, sync] = await Promise.all([
      getSt(),
      db.all(`SELECT id, name, sort FROM an_depts ORDER BY sort, id`),
      db.all(`SELECT id, dept_id, name, sort FROM an_sources ORDER BY sort, id`),
      db.all(`SELECT value, source_id FROM an_source_map ORDER BY value`),
      db.all(`SELECT office, dept_id FROM an_office_map`),
      db.all(`SELECT login, name, dept_id FROM an_managers ORDER BY name, login`),
      db.all(`SELECT id, name, keywords, sort FROM an_brands ORDER BY sort, id`),
      db.all(`SELECT office_id, name FROM offices ORDER BY CAST(office_id AS INTEGER)`),
      getJson("an_status_names"),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`),
      getJson("an_sync")
    ]);
    return c.json({
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
      sync: sync ? { phase: sync.phase, startedAt: sync.startedAt, mode: sync.mode, error: sync.error || "" } : null
    });
  });
  app.get("/api/an/values", async (c) => {
    const [ch, site, utm, users, offices, unbranded] = await Promise.all([
      db.all(`SELECT ch AS v, COUNT(*) AS n FROM an_orders WHERE ch != '' GROUP BY ch`),
      db.all(`SELECT site AS v, COUNT(*) AS n FROM an_orders WHERE site != '' GROUP BY site`),
      db.all(`SELECT utm AS v, COUNT(*) AS n FROM an_orders WHERE utm != '' GROUP BY utm`),
      db.all(`SELECT user AS v, COUNT(*) AS n FROM an_orders WHERE user != '' GROUP BY user ORDER BY n DESC`),
      db.all(`SELECT office AS v, COUNT(*) AS n FROM an_orders GROUP BY office ORDER BY n DESC`),
      db.all(`SELECT name FROM an_products WHERE brand_id = 0 ORDER BY name LIMIT 300`)
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
    return c.json({
      values: [...values.values()].sort((a, b) => b.n - a.n),
      users,
      offices,
      unbranded: unbranded.map((r) => r.name)
    });
  });
  app.put("/api/an/settings", async (c) => {
    const b = await c.req.json();
    const cur = await getSt();
    const next = { ...cur };
    if (b.compare !== void 0) next.compare = Boolean(b.compare);
    if (["manager", "office"].includes(b.deptPriority)) next.deptPriority = b.deptPriority;
    if (["net", "all"].includes(b.targetBase)) next.targetBase = b.targetBase;
    if (b.months !== void 0) next.months = Math.min(18, Math.max(1, parseInt(b.months, 10) || 6));
    await putSetting("an_settings", JSON.stringify(next));
    if (next.deptPriority !== cur.deptPriority) await remap(db, next);
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
      del.push([`UPDATE an_managers SET dept_id = NULL WHERE dept_id = ?`, [id]]);
    }
    for (const id of goneS) {
      del.push([`DELETE FROM an_sources WHERE id = ?`, [id]]);
      del.push([`DELETE FROM an_targets WHERE kind = 'src' AND ref_id = ?`, [id]]);
    }
    await db.batch([...del, ...st]);
    await remap(db, await getSt());
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
    await remap(db, await getSt());
    return c.json({ ok: true });
  });
  app.put("/api/an/managers", async (c) => {
    const list = await c.req.json();
    const st = [[`DELETE FROM an_managers`, []]];
    for (const r of Array.isArray(list) ? list : []) {
      const login = low(r.login);
      if (!login) continue;
      st.push([`INSERT OR REPLACE INTO an_managers (login, name, dept_id) VALUES (?, ?, ?)`, [login, String(r.name || "").trim(), parseInt(r.dept_id, 10) || null]]);
    }
    await db.batch(st);
    await remap(db, await getSt());
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
    return c.json({ ok: true });
  });
  app.get("/api/an/sync", async (c) => {
    const [state, last] = await Promise.all([getJson("an_sync"), db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`)]);
    return c.json({ state: state ? summary(state) : null, lastSync: last?.value || "" });
  });
  function summary(s) {
    const left = s.units?.length || 0;
    const total = s.unitsTotal || 1;
    let pct = s.phase === "units" ? Math.round((total - left) / total * 90) : s.phase === "done" ? 100 : 95;
    if (pct < 1) pct = 1;
    const u = s.units?.[0];
    const status = u ? s.statusNames?.[u.s] || `\u0441\u0442\u0430\u0442\u0443\u0441 ${u.s}` : "";
    const text = s.phase === "units" && u ? `${u.from.slice(0, 7)} \xB7 ${status}` : s.phase === "units" && s.pending?.length ? `\u0414\u043E\u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F ${s.pending.length} \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C` : s.phase === "products" ? "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457 \u0442\u043E\u0432\u0430\u0440\u0456\u0432" : s.phase === "categories" ? "\u0414\u043E\u0432\u0456\u0434\u043D\u0438\u043A \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0439" : s.phase === "cleanup" ? "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044F" : "\u0413\u043E\u0442\u043E\u0432\u043E";
    return {
      mode: s.mode,
      phase: s.phase,
      done: s.phase === "done",
      pct,
      text,
      stats: s.stats,
      warnings: s.warnings || [],
      error: s.error || "",
      startedAt: s.startedAt
    };
  }
  app.post("/api/an/sync/start", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const mode = ["full", "reset"].includes(b.mode) ? b.mode : "refresh";
    const cur = await getJson("an_sync");
    if (cur && cur.phase !== "done" && !cur.error && !b.force) return c.json({ state: summary(cur), already: true });
    const st = await getSt();
    const cr = await creds();
    const statusNames = await lp(cr, "getStatuses", {}).then((j) => j.status === "ok" ? j.data || {} : {}).catch(() => ({}));
    if (Object.keys(statusNames).length) await putSetting("an_status_names", JSON.stringify(statusNames));
    if (mode === "reset") {
      await db.batch([[`DELETE FROM an_items`, []], [`DELETE FROM an_orders`, []], [`DELETE FROM an_day_bounds`, []], [`DELETE FROM an_products`, []]]);
    }
    const today = kyivDay();
    const start = addMonths(monthStart(today), -st.months);
    const statuses = [...st.okStatuses, ...st.refuseStatuses];
    const units = [];
    for (let m = monthStart(today); m >= start; m = addMonths(m, -1)) {
      const to = monthEnd(m) > today ? today : monthEnd(m);
      for (const s of statuses) units.push({ s, from: m, to });
    }
    const state = {
      mode,
      startedAt: nowIso2(),
      start,
      today,
      refetchFrom: mode === "refresh" ? addDays(today, -7) : "9999-12-31",
      phase: "units",
      units,
      unitsTotal: units.length,
      pending: [],
      statusNames,
      stats: { listed: 0, fetched: 0, changed: 0, products: 0 },
      warnings: []
    };
    await putSetting("an_sync", JSON.stringify(state));
    return c.json({ state: summary(state) });
  });
  app.post("/api/an/sync/step", async (c) => {
    const state = await getJson("an_sync");
    if (!state) return c.json({ state: null });
    if (state.phase === "done" || state.error) return c.json({ state: summary(state) });
    if (state.lockUntil && state.lockUntil > Date.now()) return c.json({ state: summary(state), busy: true });
    state.lockUntil = Date.now() + 12e4;
    await putSetting("an_sync", JSON.stringify(state));
    const st = await getSt();
    const cr = await creds();
    const maps = await loadMaps(db, st);
    const MAX_CALLS = 5;
    const started = Date.now();
    let calls = 0;
    const warn = (w) => {
      if (!state.warnings.includes(w) && state.warnings.length < 10) state.warnings.push(w);
    };
    const save = () => putSetting("an_sync", JSON.stringify(state));
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
            if (rest.length) {
              const rows = await db.all(`SELECT id, code, day, status FROM an_orders WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(rest)]);
              for (const r of rows) {
                known.set(r.code, r);
                if (r.status !== u.s) upd.push([`UPDATE an_orders SET status = ? WHERE id = ?`, [u.s, r.id]]);
              }
            }
            state.stats.changed += upd.length;
            await db.batch(upd);
            state.pending.push(...codes.filter((x) => !known.has(x) || known.get(x).day >= state.refetchFrom));
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
            state.stats.fetched += orders.length;
            state.pending = state.pending.slice(part.length);
            continue;
          }
          if (!state.units.length) state.phase = "products";
          continue;
        }
        if (state.phase === "products") {
          const rows = await db.all(`SELECT product_id FROM an_products WHERE fetched = 0 LIMIT 50`);
          if (!rows.length) {
            state.phase = "categories";
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
          const old = await db.get(`SELECT MAX(max_id) AS hi FROM an_day_bounds WHERE day < ?`, [state.start]);
          if (old?.hi != null) {
            await db.batch([
              [`DELETE FROM an_items WHERE id < ?`, [(old.hi + 1) * 100]],
              [`DELETE FROM an_orders WHERE id <= ? AND day < ?`, [old.hi, state.start]],
              [`DELETE FROM an_day_bounds WHERE day < ?`, [state.start]]
            ]);
          }
          state.phase = "done";
          state.finishedAt = nowIso2();
          await putSetting("an_last_sync", state.finishedAt);
        }
      }
    } catch (e) {
      if (!e.pending) {
        if (!/429/.test(e.message)) state.error = e.message;
        else warn("LP-CRM \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u043B\u0430 \u0437\u0430\u0447\u0435\u043A\u0430\u0442\u0438 (429) \u2014 \u043F\u0440\u043E\u0434\u043E\u0432\u0436\u0443 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E.");
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
      await putSetting("an_sync", JSON.stringify(s));
    }
    return c.json({ ok: true });
  });
  app.post("/api/an/query", async (c) => {
    const b = await c.req.json();
    const st = await getSt();
    const today = kyivDay();
    const from = isDay(b.from) ? b.from : addDays(today, -6);
    const to = isDay(b.to) && b.to >= from ? b.to : today;
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
    const itemLevel = f.brands.length > 0 || f.cats.length > 0;
    const ok = st.okStatuses.map(Number);
    const rf = st.refuseStatuses.map(Number);
    const tracked = [...ok, ...rf];
    const ph = (a) => a.map(() => "?").join(",");
    const rfExpr = `(CASE WHEN o.status IN (${rf.join(",") || "-1"}) THEN 1 ELSE 0 END)`;
    function base(range, { items = itemLevel, skipCats = false } = {}) {
      const where = [`o.id BETWEEN ? AND ?`, `o.day BETWEEN ? AND ?`, `o.status IN (${tracked.join(",")})`];
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
          where.push(`COALESCE(p.category_id, 0) IN (${ph(f.cats)})`);
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
      const jobs = [
        db.all(`SELECT o.day AS day, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.day`, q.params),
        db.all(`SELECT o.dept AS dept, o.src AS src, o.user AS user, o.status AS status, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.dept, o.src, o.user, o.status`, q.params),
        db.all(`SELECT COALESCE(p.brand_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt, COUNT(DISTINCT CASE WHEN ${rfExpr} = 1 THEN o.id END) AS rcnt
                ${qi.from} GROUP BY COALESCE(p.brand_id, 0)`, qi.params),
        db.all(`SELECT COALESCE(p.category_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt
                ${qi.from} GROUP BY COALESCE(p.category_id, 0)`, qi.params)
      ];
      if (full) {
        jobs.push(db.all(`SELECT i.product_id AS id, MAX(p.name) AS name, MAX(p.brand_id) AS brand, SUM(i.amount) AS rev,
                SUM(i.qty) AS qty, SUM(CASE WHEN ${rfExpr} = 1 THEN i.qty ELSE 0 END) AS rqty
                ${qi.from} GROUP BY i.product_id ORDER BY rev DESC LIMIT 20`, qi.params));
      }
      const [daily, groups, brands2, cats, top2 = []] = await Promise.all(jobs);
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
      f.brands.length ? db.all(`SELECT DISTINCT COALESCE(category_id, 0) AS id FROM an_products WHERE brand_id IN (${ph(f.brands)})`, f.brands) : db.all(`SELECT DISTINCT COALESCE(category_id, 0) AS id FROM an_products`)
    ]);
    const sumRows = (rows) => rows.reduce((a, r) => ({ rev: a.rev + (r.rev || 0), net: a.net + (r.net || 0), cnt: a.cnt + (r.cnt || 0), rcnt: a.rcnt + (r.rcnt || 0) }), { rev: 0, net: 0, cnt: 0, rcnt: 0 });
    const kpi = (p) => {
      const t = sumRows(p.groups);
      return { ...t, rev: round2(t.rev), net: round2(t.net), avg: t.cnt ? round2(t.rev / t.cnt) : 0, rpct: t.cnt ? round2(t.rcnt / t.cnt * 100) : 0 };
    };
    const fillDays = (p, a, z) => {
      const map = new Map((p?.daily || []).map((r) => [r.day, r]));
      const out = [];
      for (let d = a; d <= z; d = addDays(d, 1)) {
        const r = map.get(d) || {};
        out.push({ day: d, rev: round2(r.rev || 0), net: round2(r.net || 0), cnt: r.cnt || 0 });
      }
      return out;
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
      const own = tmap.get(`${month}|dept|${id}`);
      if (own) return own;
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
    let target = { applicable: false, note: targetNote, base: factKey };
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
      return { rev: round2(a.rev), net: round2(a.net), cnt: a.cnt, rcnt: a.rcnt, prevRev: p ? round2(p.rev) : null, prevCnt: p ? p.cnt : null };
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
    const bName = new Map(brands.map((x) => [x.id, x.name]));
    const prevBrands = new Map((prev?.brands || []).map((r) => [r.id, r]));
    const byBrand = cur.brands.map((r) => ({
      id: r.id,
      name: r.id ? bName.get(r.id) || `\u0411\u0440\u0435\u043D\u0434 ${r.id}` : "\u0411\u0435\u0437 \u0431\u0440\u0435\u043D\u0434\u0443",
      rev: round2(r.rev),
      net: round2(r.net),
      qty: r.qty,
      cnt: r.cnt,
      rcnt: r.rcnt,
      avg: r.cnt ? round2(r.rev / r.cnt) : 0,
      prevRev: prev ? round2(prevBrands.get(r.id)?.rev || 0) : null
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
      prevRev: prev ? round2(prevCats.get(r.id)?.rev || 0) : null
    })).sort((a, b2) => b2.rev - a.rev);
    const top = cur.top.map((r) => ({ id: r.id, name: r.name || `\u0422\u043E\u0432\u0430\u0440 ${r.id}`, brand: r.brand ? bName.get(r.brand) || "" : "", rev: round2(r.rev), qty: r.qty, rqty: r.rqty }));
    const last = await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`);
    return c.json({
      range: { from, to, days: daysBetween(from, to) },
      cmp,
      compareEnabled: st.compare,
      targetBase: st.targetBase,
      kpi: { cur: kpi(cur), prev: prev ? kpi(prev) : null },
      daily: { cur: curDaily, prev: cmp ? fillDays(prev, cmp.from, cmp.to) : null },
      target,
      byDept,
      bySource,
      byManager,
      byStatus,
      byBrand,
      byCategory,
      top,
      options: {
        depts: [...depts.map((d) => ({ id: d.id, name: d.name })), { id: 0, name: "\u0411\u0435\u0437 \u0432\u0456\u0434\u0434\u0456\u043B\u0443" }],
        sources: sources.map((s) => ({ id: s.id, name: s.name, dept_id: s.dept_id })),
        managers: [...new Map([
          ...managers.map((m) => [m.login, { login: m.login, name: m.name || m.login, dept_id: m.dept_id }]),
          ...byManager.filter((m) => !mgrNames.has(m.login)).map((m) => [m.login, { login: m.login, name: m.login, dept_id: null }])
        ]).values()],
        brands: [...brands.map((x) => ({ id: x.id, name: x.name })), { id: 0, name: "\u0411\u0435\u0437 \u0431\u0440\u0435\u043D\u0434\u0443" }],
        cats: catOptions.map((r) => ({ id: r.id, name: r.id ? cName.get(r.id) || `\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u044F ${r.id}` : "\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u0457" })).sort((a, b2) => (a.id === 0) - (b2.id === 0) || a.name.localeCompare(b2.name, "uk"))
      },
      lastSync: last?.value || ""
    });
  });
}

// src/normalize.js
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

// src/demo.js
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

// src/checkbox.js
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
  const orderNo = String(order2.orderId);
  const orderNoRe = new RegExp(`(^|\\D)${orderNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`);
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

// src/app.js
var MASK = "\u2022\u2022\u2022\u2022\u2022\u2022";
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
var hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
};
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var publicFop = (f) => {
  if (!f) return null;
  const out = { ...f };
  for (const k of SECRET_FOP_FIELDS) out[k] = f[k] ? MASK : "";
  out.has_checkbox = hasCheckbox(f);
  return out;
};
var docFop = (f) => {
  if (!f) return null;
  const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
  return rest;
};
var parseTpl = (t) => t ? { ...t, options: JSON.parse(t.options || "{}") } : null;
function createApp({ db, fetchFn: rawFetch = fetch, maxSubrequests = Infinity }) {
  const app = new Hono3();
  let usedSubrequests = 0;
  const fetchFn = async (...args) => {
    if (++usedSubrequests > maxSubrequests) {
      throw Object.assign(new Error("\u041E\u0431\u0440\u043E\u0431\u043A\u0430 \u0442\u0440\u0438\u0432\u0430\u0454\u2026"), { pending: true });
    }
    return rawFetch(...args);
  };
  const receiptCache = /* @__PURE__ */ new Map();
  const settings = async () => {
    const rows = await db.all(`SELECT key, value FROM settings`);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  };
  app.onError((err, c) => {
    if (err.pending) return c.json({ pending: true, message: err.message }, 202);
    if (!err.status) console.error(err);
    return c.json({ error: err.message || String(err) }, err.status || 500);
  });
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const need = (c, perm) => {
    if (!can(c.get("user"), perm)) throw fail(403, "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043D\u044C\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u0446\u0456\u0454\u0457 \u0434\u0456\u0457.");
  };
  const userName = (c) => c.get("user")?.name || c.get("user")?.login || "";
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60 * 60 * 1e3) return;
    lastCleanup = Date.now();
    const s = await settings();
    const days = Math.max(1, Number(s.retention_days) || 7);
    const border = new Date(Date.now() - days * 864e5).toISOString();
    await db.run(`DELETE FROM versions WHERE created_at < ?`, [border]);
    await db.run(`DELETE FROM invoices WHERE COALESCE(updated_at, created_at) < ?`, [border]);
    await db.run(`DELETE FROM sessions WHERE created_at < ?`, [new Date(Date.now() - 90 * 864e5).toISOString()]);
  }
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
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    const user = await sessionUser(c);
    if (!user) throw fail(401, "\u041F\u043E\u0442\u0440\u0456\u0431\u043D\u043E \u0443\u0432\u0456\u0439\u0442\u0438.");
    c.set("user", user);
    await cleanup();
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
  const ASSIGNABLE = ["admin", "manager", "viewer"];
  app.get("/api/users", async (c) => {
    need(c, "users");
    const rows = await db.all(`SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, login`);
    return c.json({ users: rows.map(publicUser), roles: ROLES });
  });
  app.post("/api/users", async (c) => {
    need(c, "users");
    const b = await c.req.json();
    const login = String(b.login || "").trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw fail(400, "\u041B\u043E\u0433\u0456\u043D: \u043B\u0430\u0442\u0438\u043D\u0441\u044C\u043A\u0456 \u043B\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438, \u043A\u0440\u0430\u043F\u043A\u0430, \u0434\u0435\u0444\u0456\u0441 (2\u201340 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432).");
    if (!ASSIGNABLE.includes(b.role)) throw fail(400, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0440\u043E\u043B\u044C.");
    if (String(b.password || "").length < 6) throw fail(400, "\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043D\u0435 \u043C\u0435\u043D\u0448\u0435 6 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432.");
    if (await db.get(`SELECT id FROM users WHERE login = ?`, [login])) throw fail(400, "\u0422\u0430\u043A\u0438\u0439 \u043B\u043E\u0433\u0456\u043D \u0443\u0436\u0435 \u0454.");
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`, [
      login,
      String(b.name || "").trim(),
      await hashPassword(b.password),
      b.role,
      nowIso()
    ]);
    return c.json({ id: r.lastId });
  });
  app.put("/api/users/:id", async (c) => {
    need(c, "users");
    const me = c.get("user");
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param("id")]);
    if (!target) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (target.role === "owner" && me.role !== "owner") throw fail(403, "\u0410\u043A\u0430\u0443\u043D\u0442 \u0432\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u043C\u043E\u0436\u0435 \u0437\u043C\u0456\u043D\u044E\u0432\u0430\u0442\u0438 \u043B\u0438\u0448\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u043A.");
    const b = await c.req.json();
    const sets = [];
    const vals = [];
    if (b.name !== void 0) {
      sets.push("name = ?");
      vals.push(String(b.name).trim());
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
  app.delete("/api/users/:id", async (c) => {
    need(c, "users");
    const me = c.get("user");
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param("id")]);
    if (!target) throw fail(404, "\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E.");
    if (target.role === "owner") throw fail(403, "\u0410\u043A\u0430\u0443\u043D\u0442 \u0432\u043B\u0430\u0441\u043D\u0438\u043A\u0430 \u0432\u0438\u0434\u0430\u043B\u0438\u0442\u0438 \u043D\u0435 \u043C\u043E\u0436\u043D\u0430.");
    if (String(target.id) === String(me.id)) throw fail(400, "\u041D\u0435 \u043C\u043E\u0436\u043D\u0430 \u0432\u0438\u0434\u0430\u043B\u0438\u0442\u0438 \u0432\u043B\u0430\u0441\u043D\u0438\u0439 \u0430\u043A\u0430\u0443\u043D\u0442.");
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
    await db.run(`DELETE FROM users WHERE id = ?`, [target.id]);
    return c.json({ ok: true });
  });
  app.get("/api/bootstrap", async (c) => {
    const s = await settings();
    const user = c.get("user");
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
      settings: apiOk ? { ...s, lpcrm_key: s.lpcrm_key ? MASK : "" } : Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith("lpcrm_") && !k.startsWith("checkbox_")).concat([["lpcrm_key", s.lpcrm_key ? MASK : ""], ["lpcrm_subdomain", s.lpcrm_subdomain || ""]]))
    });
  });
  app.put("/api/settings", async (c) => {
    need(c, "refs.edit");
    const body = await c.req.json();
    const apiKeys = ["lpcrm_subdomain", "lpcrm_key", "lpcrm_search_days", "checkbox_enabled", "checkbox_search_days"];
    const general = ["invoice_date_mode", "default_fop_id", "seller_note", "retention_days", "rahunok_next_number"];
    const allowed = can(c.get("user"), "api") ? [...apiKeys, ...general] : general;
    if (body.rahunok_next_number !== void 0 && !/^\d{1,12}$/.test(String(body.rahunok_next_number).trim())) throw fail(400, "\u041D\u043E\u043C\u0435\u0440 \u0440\u0430\u0445\u0443\u043D\u043A\u0443 \u2014 \u043B\u0438\u0448\u0435 \u0446\u0438\u0444\u0440\u0438.");
    if (body.retention_days !== void 0 && !(Number(body.retention_days) >= 1)) throw fail(400, "\u0421\u0442\u0440\u043E\u043A \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u043D\u043D\u044F \u2014 \u0449\u043E\u043D\u0430\u0439\u043C\u0435\u043D\u0448\u0435 1 \u0434\u0435\u043D\u044C.");
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
    const b = await c.req.json();
    if (!b.short_name) return c.json({ error: "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0440\u043E\u0442\u043A\u0443 \u043D\u0430\u0437\u0432\u0443 \u0424\u041E\u041F" }, 400);
    const cols = fopCols(c, b);
    const r = await db.run(
      `INSERT INTO fops (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => b[k])
    );
    return c.json({ id: r.lastId });
  });
  app.put("/api/fops/:id", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    const cols = fopCols(c, b);
    if (!cols.length) return c.json({ ok: true });
    await db.run(`UPDATE fops SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [
      ...cols.map((k) => b[k]),
      c.req.param("id")
    ]);
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
    for (const o of list) {
      if (!o.office_id) continue;
      await db.run(
        `INSERT INTO offices (office_id, name, fop_id, seller_text) VALUES (?, ?, ?, ?)
         ON CONFLICT(office_id) DO UPDATE SET name = excluded.name, fop_id = excluded.fop_id, seller_text = excluded.seller_text`,
        [String(o.office_id).trim(), o.name || "", o.fop_id || null, String(o.seller_text || "").trim()]
      );
    }
    return c.json({ ok: true });
  });
  app.put("/api/channels", async (c) => {
    need(c, "refs.edit");
    const list = await c.req.json();
    await db.run(`DELETE FROM channels`);
    for (const ch of list) {
      const name = String(ch.name || "").trim();
      if (!name) continue;
      await db.run(`INSERT INTO channels (name, fop_id, seller_text) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fop_id = excluded.fop_id, seller_text = excluded.seller_text`, [name, ch.fop_id || null, String(ch.seller_text || "").trim()]);
    }
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
  let syncing = null;
  let lastSync = 0;
  const ymd2 = (d) => d.toISOString().slice(0, 10);
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const STATUS_PRIORITY = ["11", "3", "56", "14", "18", "66", "60", "53"];
  async function cachedStatuses(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache && cache.sub === creds.subdomain && Date.now() - cache.at < 864e5) return cache.list;
    const list = Object.keys(await getStatuses(fetchFn, creds));
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
      JSON.stringify({ at: Date.now(), sub: creds.subdomain, list })
    ]);
    return list;
  }
  async function saveOrders2(orders) {
    for (const o of orders) {
      await db.run(
        `INSERT INTO orders_index (code, datetime, phone, ttn, bayer_name, data, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET datetime = excluded.datetime, phone = excluded.phone, ttn = excluded.ttn,
         bayer_name = excluded.bayer_name, data = excluded.data, fetched_at = excluded.fetched_at`,
        [String(o.order_id), o.datetime || "", digits(o.phone), String(o.ttn || ""), o.bayer_name || "", JSON.stringify(o), nowIso()]
      );
    }
  }
  async function syncIndex(creds, days, found = async () => []) {
    if (syncing) {
      await syncing;
      return found();
    }
    let result = [];
    syncing = (async () => {
      const all = await cachedStatuses(creds);
      const statuses = [...STATUS_PRIORITY.filter((x) => all.includes(x)), ...all.filter((x) => !STATUS_PRIORITY.includes(x))];
      const start = ymd2(new Date(Date.now() - days * 864e5));
      const end = ymd2(new Date(Date.now() + 864e5));
      const key = `${creds.subdomain}|${days}|${start}`;
      const pr = await db.get(`SELECT value FROM settings WHERE key = 'sync_progress'`);
      const prog = pr?.value ? JSON.parse(pr.value) : null;
      let i = prog && prog.key === key && Date.now() - prog.at < 30 * 6e4 ? prog.i : 0;
      const saveProgress = (idx) => db.run(
        `INSERT INTO settings (key, value) VALUES ('sync_progress', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify({ key, i: idx, at: Date.now() })]
      );
      for (; i < statuses.length; i++) {
        const codes = await getOrderCodesByStatus(fetchFn, creds, statuses[i], start, end);
        const known = new Set((await db.all(`SELECT code FROM orders_index`)).map((r) => r.code));
        const fresh = codes.filter((c) => !known.has(c));
        for (let k = 0; k < fresh.length; k += 100) {
          await saveOrders2(await getOrdersBatch(fetchFn, creds, fresh.slice(k, k + 100)));
        }
        await saveProgress(i + 1);
        result = await found();
        if (result.length) break;
      }
      await db.run(`DELETE FROM settings WHERE key = 'sync_progress'`);
      lastSync = Date.now();
    })();
    try {
      await syncing;
    } finally {
      syncing = null;
    }
    return result;
  }
  const SKIP_KEYS = /* @__PURE__ */ new Set(["total", "status", "office", "payment", "delivery_id", "attribute_status_id", "localization"]);
  async function matchIndex(q) {
    const rows = await db.all(`SELECT code, datetime, phone, ttn, data FROM orders_index ORDER BY datetime DESC`);
    const qd = digits(q);
    const strong = [];
    const weak = [];
    for (const r of rows) {
      const data = JSON.parse(r.data || "{}");
      const exact = Object.entries(data).some(([k, v]) => v !== null && typeof v !== "object" && !SKIP_KEYS.has(k) && String(v).trim() === q);
      if (exact || r.ttn === q) strong.push(r);
      else if (qd.length >= 9 && r.phone && r.phone.endsWith(qd)) weak.push(r);
    }
    return strong.length ? strong : weak;
  }
  async function resolveCode(q, s, creds) {
    if (/^\d{11,}$/.test(q) && !q.startsWith("380")) return { code: q };
    const alias = await db.get(`SELECT code FROM order_alias WHERE alias = ?`, [q]);
    if (alias) return { code: alias.code };
    let hits = await matchIndex(q);
    const maxDays = Number(s.lpcrm_search_days) || 30;
    if (!hits.length) hits = await syncIndex(creds, Math.min(7, maxDays), () => matchIndex(q));
    if (!hits.length && maxDays > 7) hits = await syncIndex(creds, maxDays, () => matchIndex(q));
    if (!hits.length) {
      throw new Error(`\u0417\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F \xAB${q}\xBB \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0441\u0435\u0440\u0435\u0434 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u044C \u0437\u0430 \u043E\u0441\u0442\u0430\u043D\u043D\u0456 ${Number(s.lpcrm_search_days) || 30} \u0434\u043D\u0456\u0432. \u0412\u0432\u0435\u0434\u0456\u0442\u044C \u043A\u043E\u0434 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F (ID-o \u0443 \u0448\u0430\u043F\u0446\u0456 \u043A\u0430\u0440\u0442\u043A\u0438 LP-CRM), \u0442\u0435\u043B\u0435\u0444\u043E\u043D \u043F\u043E\u043A\u0443\u043F\u0446\u044F \u0430\u0431\u043E \u0422\u0422\u041D.`);
    }
    const note = hits.length > 1 ? `\u0417\u043D\u0430\u0439\u0434\u0435\u043D\u043E ${hits.length} \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F(\u043D\u044C) \u0437\u0430 \xAB${q}\xBB \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043D\u0430\u0439\u043D\u043E\u0432\u0456\u0448\u0435.` : "";
    if (hits.length === 1 && !/^\d{9,}$/.test(digits(q))) {
      await db.run(`INSERT INTO order_alias (alias, code) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET code = excluded.code`, [q, hits[0].code]);
    }
    return { code: hits[0].code, note };
  }
  async function loadOrder(orderId, s, fresh = false) {
    if (orderId === "demo" || orderId === "0") {
      return { rawOrder: DEMO_ORDER, demo: true };
    }
    const creds = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    if (!creds.subdomain || !creds.key) throw new Error("\u041D\u0435 \u043D\u0430\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E LP-CRM: \u0432\u043A\u0430\u0436\u0456\u0442\u044C \u043F\u0456\u0434\u0434\u043E\u043C\u0435\u043D \u0456 API-\u043A\u043B\u044E\u0447 \u0443 \u0440\u043E\u0437\u0434\u0456\u043B\u0456 \xAB\u041D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\xBB.");
    const { code, note } = await resolveCode(orderId, s, creds);
    const { order: order2, raw: raw2 } = await getOrder(fetchFn, creds, code, { fresh });
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
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(/* @__PURE__ */ new Date());
    const autoInvoiceDate = s.invoice_date_mode === "order" ? String(crmOrder.date || "").slice(0, 10) || today : today;
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
        JSON.stringify(inv),
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
  const EXPORT_TABLES = ["templates", "fops", "offices", "channels", "inv_fops"];
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
    for (const t of EXPORT_TABLES) {
      out.tables[t] = (await db.all(`SELECT * FROM ${t}`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLS.has(k))));
    }
    const s = await settings();
    for (const k of EXPORT_SETTINGS) if (s[k] !== void 0) out.settings[k] = s[k];
    return c.json(out);
  });
  app.post("/api/admin/import", async (c) => {
    need(c, "users");
    const b = await c.req.json();
    if (!b?.tables) throw fail(400, "\u0426\u0435 \u043D\u0435 \u0444\u0430\u0439\u043B \u0435\u043A\u0441\u043F\u043E\u0440\u0442\u0443 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u044C.");
    const counts = {};
    for (const t of EXPORT_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      const cols = new Set((await db.all(`PRAGMA table_info(${t})`)).map((x) => x.name));
      await db.run(`DELETE FROM ${t}`);
      for (const r of rows) {
        const keys = Object.keys(r).filter((k) => cols.has(k) && !SECRET_COLS.has(k));
        await db.run(`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => r[k]));
      }
      counts[t] = rows.length;
    }
    for (const [k, v] of Object.entries(b.settings || {})) {
      if (!EXPORT_SETTINGS.includes(k)) continue;
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v)]);
    }
    return c.json({ ok: true, counts });
  });
  const INV_FOP_FIELDS = ["short_name", "full_name", "ipn", "iban", "bank", "address", "phone", "warning_text", "signature", "stamp", "active"];
  app.post("/api/inv-fops", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    if (!String(b.short_name || "").trim()) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0440\u043E\u0442\u043A\u0443 \u043D\u0430\u0437\u0432\u0443 \u0424\u041E\u041F.");
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== void 0);
    const r = await db.run(`INSERT INTO inv_fops (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((k) => b[k]));
    return c.json({ id: r.lastId });
  });
  app.put("/api/inv-fops/:id", async (c) => {
    need(c, "refs.edit");
    const b = await c.req.json();
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== void 0);
    if (cols.length) {
      await db.run(`UPDATE inv_fops SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...cols.map((k) => b[k]), c.req.param("id")]);
    }
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
  const round23 = (n) => Math.round(n * 100) / 100;
  const toNum = (v) => {
    const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  async function buildRahunok(b, number) {
    const fop = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [b.fop_id]);
    if (!fop) throw fail(400, "\u041E\u0431\u0435\u0440\u0456\u0442\u044C \u0424\u041E\u041F, \u0432\u0456\u0434 \u044F\u043A\u043E\u0433\u043E \u0432\u0438\u0441\u0442\u0430\u0432\u043B\u044F\u0454\u0442\u044C\u0441\u044F \u0440\u0430\u0445\u0443\u043D\u043E\u043A.");
    const clientName = String(b.client?.name || "").trim();
    if (!clientName) throw fail(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043D\u0430\u0437\u0432\u0443 \u043A\u043B\u0456\u0454\u043D\u0442\u0430.");
    const items = (b.items || []).map((i) => ({ name: String(i.name || "").trim(), qty: toNum(i.qty), price: round23(toNum(i.price)) })).filter((i) => i.name);
    if (!items.length) throw fail(400, "\u0414\u043E\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0442\u043E\u0432\u0430\u0440.");
    for (const i of items) {
      if (!(i.qty > 0)) throw fail(400, `\u041A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0434\u043B\u044F \xAB${i.name}\xBB \u043C\u0430\u0454 \u0431\u0443\u0442\u0438 \u0431\u0456\u043B\u044C\u0448\u043E\u044E \u0437\u0430 0.`);
      i.unit = "\u0448\u0442";
      i.sum = round23(i.qty * i.price);
    }
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(/* @__PURE__ */ new Date());
    const { signature, stamp, ...fopRest } = fop;
    return {
      number: String(number),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : today,
      source: b.source === "crm" ? "crm" : "manual",
      orderRef: String(b.order_ref || ""),
      fop: { ...fopRest, signature, stamp, warning_text: fop.warning_text || DEFAULT_WARNING },
      client: { name: clientName, edrpou: String(b.client?.edrpou || "").trim(), contract: String(b.client?.contract || "").trim() },
      items,
      total: round23(items.reduce((t, i) => t + i.sum, 0))
    };
  }
  app.get("/api/rahunky", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const rows = await db.all(
      `SELECT id, number, source, order_ref, fop_name, client_name, total, created_at, created_by, updated_at, updated_by FROM invoices
       ${q ? "WHERE number LIKE ? OR client_name LIKE ? OR order_ref LIKE ?" : ""} ORDER BY id DESC LIMIT 300`,
      q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []
    );
    const s = await settings();
    return c.json({ rows, nextNumber: s.rahunok_next_number || "10516", retentionDays: Number(s.retention_days) || 7 });
  });
  app.get("/api/rahunky/:id", async (c) => {
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param("id")]);
    if (!row) throw fail(404, "\u0420\u0430\u0445\u0443\u043D\u043E\u043A \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E (\u043C\u043E\u0436\u043B\u0438\u0432\u043E, \u043C\u0438\u043D\u0443\u0432 \u0441\u0442\u0440\u043E\u043A \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u043D\u043D\u044F).");
    return c.json({ ...row, data: JSON.parse(row.data) });
  });
  app.post("/api/rahunky", async (c) => {
    need(c, "docs.edit");
    const b = await c.req.json();
    let number;
    if (b.source === "crm") {
      number = String(b.number || "").trim();
      if (!number) throw fail(400, "\u041D\u0435\u043C\u0430\u0454 \u043D\u043E\u043C\u0435\u0440\u0430 \u0437\u0430\u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F CRM.");
    } else {
      const s = await settings();
      number = String(Number(s.rahunok_next_number) || 10516);
    }
    const data = await buildRahunok(b, number);
    if (b.source !== "crm") {
      await db.run(`UPDATE settings SET value = ? WHERE key = 'rahunok_next_number'`, [String(Number(number) + 1)]);
    }
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
  mountAnalytics(app, { db, fetchFn, settings, need, fail, nowIso });
  return app;
}

// src/db-d1.js
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
    const tag = `${env.OWNER_RESET_PASSWORD.length}:${[...env.OWNER_RESET_PASSWORD].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0) >>> 0, 7)}`;
    if (mark?.value !== tag) {
      await resetOwnerPassword(db, env.OWNER_RESET_PASSWORD);
      await db.run(`INSERT INTO settings (key, value) VALUES ('owner_reset_mark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [tag]);
    }
  }
  const fetchFn = env.LPCRM_TEST_URL ? (url, opts) => fetch(String(url).replace(/^https?:\/\/[^/]+\.lp-crm\.biz/, env.LPCRM_TEST_URL), opts) : fetch;
  const app = createApp({ db, fetchFn, maxSubrequests: Number(env.MAX_SUBREQUESTS) || 40 });
  return app.fetch(request, env, ctx);
}
export {
  onRequest
};
