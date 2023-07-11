import { Payload } from '../_handler.ts'

export class ResponseContext {
  #i

  constructor(__internal: {
    b: Exclude<Payload, void> | null
    c: number
    h: Headers
  }) {
    this.#i = __internal
  }

  get body(): Exclude<Payload, void> | null {
    return this.#i.b
  }

  set body(data: Exclude<Payload, void> | null) {
    this.#i.b = data
  }

  /**
   * Set the status code of the response.
   */
  code(code: number) {
    this.#i.c = code
  }

  /**
   * Attach a cookie to the response.
   */
  cookie(
    name: string,
    value: string,
    options?: {
      expiresAt?: Date
      maxAge?: number
      domain?: string
      path?: string
      secure?: boolean
      httpOnly?: boolean
      sameSite?:
        | 'strict'
        | 'lax'
        | 'none'
    },
  ) {
    let cookie = `${name}=${value};`

    this.#i.h.append(
      'set-cookie',
      (
        options?.expiresAt &&
        (cookie += ` expires=${options.expiresAt.toUTCString()};`),
          options?.maxAge && (cookie += ` max-age=${options.maxAge};`),
          options?.domain && (cookie += ` domain=${options.domain};`),
          options?.path && (cookie += ` path=${options.path};`),
          options?.secure && (cookie += ' secure;'),
          options?.httpOnly && (cookie += ' httpOnly;'),
          options?.sameSite &&
          (cookie += ` sameSite=${
            options.sameSite.charAt(0).toUpperCase() +
            options.sameSite.slice(1)
          };`),
          cookie
      ),
    )
  }

  /**
   * Attach a header to the response.
   */
  header(name: string, value: string | undefined) {
    if (value === undefined) {
      this.#i.h.delete(name)
    } else {
      this.#i.h.set(name, value)
    }
  }

  /**
   * Redirect the incoming request.
   *
   * @param destination e.g. https://google.com
   * @param code e.g. 301, default 307
   */
  redirect(destination: string, code = 307) {
    this.#i.c = code
    this.#i.h.set('location', destination)
  }
}
