import { Extension, Preferences } from '../mod.ts'
import { base } from './_base.ts'
import { Handler, Payload, Route } from './_handler.ts'
import { Collection } from './Collection.ts'
import { Context } from './context/Context.ts'
import { isValidExtension } from './extensions.ts'
import { colors, ConnInfo } from './deps.ts'
import { Exception } from './Exception.ts'
import { Router } from './Router.ts'

type RequestContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

export class cheetah extends base<cheetah>() {
  #router
  #runtime: 'deno' | 'cloudflare'
  #base
  #cors
  #cache
  #debugging
  #notFound
  #error
  #preflight
  #ext: [string, Extension][]

  // #plugins: {
  //   beforeParsing: [string, ((request: Request) => void | Promise<void>)][]
  //   beforeHandling: [
  //     string,
  //     ((
  //       c: Context<
  //         Record<string, never>,
  //         unknown,
  //         unknown,
  //         Record<string, string>,
  //         unknown
  //       >,
  //     ) => ResponsePayload | Promise<ResponsePayload>),
  //   ][]
  //   beforeResponding: [
  //     string,
  //     ((
  //       c: Context<
  //         Record<string, never>,
  //         unknown,
  //         unknown,
  //         Record<string, string>,
  //         unknown
  //       >,
  //     ) => ResponsePayload | Promise<ResponsePayload>),
  //   ][]
  // }

  constructor({
    base,
    cors,
    cache,
    debug = false,
    preflight = false,
    error,
    notFound,
  }: Preferences = {}) {
    super((method, pathname, handlers) => {
      this.#router.add(
        method,
        this.#base ? this.#base + pathname : pathname,
        handlers,
      )

      return this
    })

    this.#router = new Router()

    this.#base = base === '/' ? undefined : base
    this.#cors = cors
    this.#cache = cache
      ? {
        name: cache.name,
        maxAge: cache.maxAge ?? 0,
      }
      : undefined
    this.#debugging = debug
    this.#error = error
    this.#notFound = notFound
    this.#preflight = preflight
    this.#ext = []

    const runtime = globalThis?.Deno
      ? 'deno'
      : typeof (globalThis as any)?.WebSocketPair === 'function'
      ? 'cloudflare'
      : 'unknown'

    if (runtime === 'unknown') {
      throw new Error('Unknown Runtime')
    }

    this.#runtime = runtime
  }

  use<T extends Collection>(...exts: Extension[]): this
  use<T extends Collection>(
    prefix: `/${string}`,
    ...exts: Extension[]
  ): this
  use<T extends Collection>(
    prefix: `/${string}`,
    collection: T,
    ...exts: Extension[]
  ): this

  use<T extends Collection>(...items: (`/${string}` | T | Extension)[]) {
    let prefix

    for (const item of items) {
      if (typeof item === 'string') { // prefix
        prefix = item
      } else if (item instanceof Collection) { // collection
        if (!prefix) {
          throw new Error(
            'Please define a prefix when attaching a collection!',
          )
        }

        const length = item.routes.length

        for (let i = 0; i < length; ++i) {
          let url = item.routes[i][1]

          if (url === '/') {
            url = ''
          }

          if (prefix === '/') {
            // @ts-ignore:
            prefix = ''
          }

          this.#router.add(
            item.routes[i][0],
            this.#base ? this.#base + prefix + url : prefix + url,
            item.routes[i][2],
          )
        }
      } else if (isValidExtension(item)) { // extension
        if (!prefix) {
          prefix = '*'
        }

        this.#ext.push([prefix, item])
      }
    }

    return this
  }

  /* -------------------------------------------------------------------------- */
  /* Fetch Handler                                                              */
  /* -------------------------------------------------------------------------- */

  fetch = async (
    request: Request,
    env: Record<string, unknown> | ConnInfo = {},
    context?: RequestContext,
  ): Promise<Response> => {
    let cache: Cache | undefined

    const ip = env?.remoteAddr
      ? ((env as ConnInfo & { remoteAddr: { hostname: string } }).remoteAddr)
        .hostname
      : request.headers.get('cf-connecting-ip') ?? undefined

    if (
      this.#cache && request.method === 'GET' && this.#runtime === 'cloudflare'
    ) {
      cache = await caches.open(this.#cache.name)

      const cachedResponse = await cache.match(request)

      if (cachedResponse) {
        return cachedResponse
      }
    }

    const url = new URL(request.url)

    let body: Response | void = undefined

    for (let i = 0; i < this.#ext.length; i++) {
      if (
        this.#ext[i][0] !== '*' && !url.pathname.startsWith(this.#ext[i][0])
      ) {
        continue
      }

      const { onRequest } = this.#ext[i][1]

      if (onRequest !== undefined) {
        const result = await onRequest(request, this.#ext[i][1].__config)

        if (result !== undefined) {
          body = result
        }
      }
    }

    if (body !== undefined) {
      return body
    }

    try {
      const route = this.#router.match(
        request.method,
        url.pathname,
        this.#preflight,
      )

      if (!route) {
        if (this.#notFound) {
          if (request.method !== 'HEAD') {
            return await this.#notFound(request)
          }

          const response = await this.#notFound(request)

          return new Response(null, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText,
          })
        }

        throw new Exception(404)
      }

      let response = await this.#handle(
        request,
        env,
        context?.waitUntil ??
          ((promise: Promise<unknown>) => {
            setTimeout(async () => {
              await promise
            }, 0)
          }),
        ip,
        url,
        route.params,
        route.handlers,
      )

      if (request.method === 'HEAD') {
        response = new Response(null, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        })
      }

      if (cache && response.ok && context) {
        context.waitUntil(cache.put(request, response.clone()))
      }

      if (this.#debugging) {
        this.#log(
          response.ok ? 'fetch' : 'error',
          request.method,
          url.pathname,
          response.status,
        )
      }

      return response
    } catch (err) {
      //console.log(err)

      let res: Response

      if (err instanceof Exception) {
        res = err.response(request)
      } else if (this.#error) {
        res = await this.#error(err, request)
      } else {
        res = new Exception('Something Went Wrong').response(request)
      }

      if (this.#debugging) {
        this.#log('error', request.method, url.pathname, res.status)
      }

      if (request.method === 'HEAD') {
        res = new Response(null, {
          headers: res.headers,
          status: res.status,
          statusText: res.statusText,
        })
      }

      return res
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Request Handler                                                            */
  /* -------------------------------------------------------------------------- */

  async #handle(
    request: Request,
    env: Record<string, any>,
    waitUntil: RequestContext['waitUntil'],
    ip: string | undefined,
    url: URL,
    params: Record<string, string | undefined>,
    route: Route[],
  ) {
    const options = typeof route[0] !== 'function' ? route[0] : null

    /* Preflight Request -------------------------------------------------------- */

    if (
      request.method === 'OPTIONS' &&
      request.headers.has('origin') &&
      request.headers.has('access-control-request-method')
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          ...((this.#cors || options?.cors) &&
            { 'access-control-allow-origin': options?.cors ?? this.#cors }),
          'access-control-allow-methods': '*',
          'access-control-allow-headers':
            request.headers.get('access-control-request-headers') ?? '*',
          'access-control-allow-credentials': 'false',
          'access-control-max-age': '600',
        },
      })
    }

    /* Set Variables ------------------------------------------------------------ */

    /* Construct Context -------------------------------------------------------- */

    // const responseHeaders: Record<string, string> = {
    //   ...(this.#cors && {
    //     'access-control-allow-origin': this.#cors,
    //   }),
    //   ...(request.method === 'GET' && {
    //     'cache-control': !this.#cache || this.#cache.maxAge === 0
    //       ? 'max-age=0, private, must-revalidate'
    //       : `max-age: ${this.#cache.maxAge}`,
    //   }),
    // }

    // if (options?.cache !== undefined) {
    //   responseHeaders['cache-control'] =
    //     options.cache === false || options.cache.maxAge === 0
    //       ? `max-age=0, private, must-revalidate`
    //       : `max-age: ${options.cache.maxAge}`
    // }

    const __internal: {
      b: Exclude<Payload, void> | null
      c: number
      h: Headers
    } = {
      b: null,
      c: 200,
      h: new Headers(),
    }

    const context = new Context(
      __internal,
      env,
      ip,
      params,
      request,
      this.#runtime,
      // @ts-ignore:
      options,
      waitUntil,
    )

    /* Route Handling ----------------------------------------------------------- */

    const length = route.length

    let next = false

    for (let i = 0; i < length; ++i) {
      if (typeof route[i] !== 'function') {
        continue
      }

      if (__internal.b && !next) {
        break
      }

      next = false

      const result = await (route[i] as Handler<unknown>)(
        context,
        () => {
          next = true
        },
      )

      if (result) {
        __internal.b = result
      }
    }

    /* Construct Response ------------------------------------------------------- */

    let c = __internal.c
    const h = __internal.h

    if (c !== 200 && c !== 301) {
      h.delete('cache-control')
    }

    if (h.has('location')) {
      return new Response(null, {
        headers: h,
        status: c,
      })
    }

    if (!__internal.b) {
      return new Response(null, {
        headers: h,
        status: c,
      })
    }

    if (
      __internal.b !== null && __internal.b !== undefined
    ) {
      if (typeof __internal.b === 'string') {
        h.set('content-length', __internal.b.length.toString())

        if (!h.has('content-type')) {
          h.set('content-type', 'text/plain; charset=utf-8')
        }
      } else if (
        __internal.b instanceof ArrayBuffer ||
        __internal.b instanceof Uint8Array
      ) {
        h.set('content-length', __internal.b.byteLength.toString())
      } else if (__internal.b instanceof Blob) {
        h.set('content-length', __internal.b.size.toString())
      } else if (
        __internal.b instanceof FormData ||
        __internal.b instanceof ReadableStream
      ) {
        // TODO: calculate content length
      } else {
        __internal.b = JSON.stringify(__internal.b)

        h.set('content-length', __internal.b.length.toString())

        if (!h.has('content-type')) {
          h.set('content-type', 'application/json; charset=utf-8')
        }

        if (((__internal.b as unknown) as { code: number }).code) {
          c = ((__internal.b as unknown) as { code: number }).code
        }
      }
    }

    for (let i = 0; i < this.#ext.length; i++) {
      if (
        this.#ext[i][0] !== '*' && !url.pathname.startsWith(this.#ext[i][0])
      ) {
        continue
      }

      const { onResponse } = this.#ext[i][1]

      if (onResponse !== undefined) {
        onResponse(context, this.#ext[i][1].__config)
      }
    }

    return new Response(__internal.b as BodyInit, {
      headers: h,
      status: c,
    })
  }

  /* -------------------------------------------------------------------------- */
  /* Logger                                                                     */
  /* -------------------------------------------------------------------------- */

  #log(
    event: 'fetch' | 'error',
    method: string,
    pathname: string,
    statusCode: number,
  ) {
    if (!this.#debugging) {
      return
    }

    if (event === 'error') {
      console.error(
        colors.gray(
          `${colors.brightRed(statusCode.toString())} - ${method} ${pathname}`,
        ),
      )
    } else {
      console.log(
        colors.gray(
          `${
            statusCode === 301 || statusCode === 307
              ? colors.brightBlue(statusCode.toString())
              : colors.brightGreen(statusCode.toString())
          } - ${method} ${colors.white(pathname)}`,
        ),
      )
    }
  }

  /* serve -------------------------------------------------------------------- */

  serve({
    hostname,
    port,
  }: {
    hostname?: string
    port?: number
  } = {}) {
    return Deno.serve({
      hostname,
      port,
      // @ts-ignore
    }, this.fetch).finished
  }
}
