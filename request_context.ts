// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import {
  deadline as resolveWithDeadline,
  DeadlineError,
} from 'std/async/deadline.ts'
import { z, ZodStringDef, ZodType, ZodUnionDef } from 'zod'
import { Method } from './base.ts'
import { BaseType, ObjectType } from './handler.ts'
import { AppContext, Context } from './mod.ts'

type Static<T extends ZodType> = T extends ZodType ? z.infer<T>
  : never

export class RequestContext<
  Params extends Record<string, unknown> = Record<string, never>,
  ValidatedBody extends ZodType = never,
  ValidatedCookies extends ObjectType = never,
  ValidatedHeaders extends ObjectType = never,
  ValidatedQuery extends ObjectType = never,
> {
  #c: Record<string, string | undefined> | undefined
  #h: Record<string, string | undefined> | undefined
  #a: AppContext
  #p
  #q: Record<string, unknown> | undefined
  #r
  #s
  #e

  constructor(
    a: AppContext,
    p: Record<string, string | undefined>,
    r: Request,
    s: {
      body?: ZodType | undefined
      cookies?: ObjectType | undefined
      headers?: ObjectType | undefined
      query?: ObjectType | undefined
      params?: Record<string, ZodType>
      [key: string]: unknown
    } | null,
    e: Context['exception'],
  ) {
    this.#a = a
    this.#p = p
    this.#r = r
    this.#s = s
    this.#e = e
  }

  get gateway(): number {
    return this.#a.gateway ?? -1
  }

  get ip(): string {
    return this.#a.ip
  }

  /**
   * The method of the incoming request.
   *
   * @example 'GET'
   * @since v0.12
   */
  get method() {
    return this.#r.method as Uppercase<Method>
  }

  /**
   * A method to retrieve the corresponding value of a parameter.
   */
  param<T extends keyof Params>(name: T): Params[T] {
    if (this.#s?.params && this.#s.params[name as string]) {
      const result = this.#s.params[name as string].safeParse(this.#p[name])

      if (!result.success) {
        throw this.#e('Bad Request')
      }

      return result.data as Params[T]
    } else {
      return this.#p[name as string] as Params[T]
    }
  }

  /**
   * Retrieve the original request object.
   *
   * @since v1.0
   */
  get raw() {
    return this.#r
  }

  /**
   * The validated body of the incoming request.
   */
  async body(options?: {
    /**
     * This enables the conversion of a FormData request body into a JSON object (if the request body has the MIME type `multipart/form-data`).
     *
     * @default false
     */
    transform: boolean
  }): Promise<
    [ValidatedBody] extends [never] ? unknown : Static<ValidatedBody>
  > {
    if (!this.#s?.body) {
      // @ts-ignore:
      return undefined
    }

    let body

    try {
      if (
        (this.#s.body as BaseType<ZodStringDef>)._def.typeName ===
          'ZodString' ||
        (this.#s.body as BaseType<ZodUnionDef>)._def.typeName === 'ZodUnion' &&
          (this.#s.body as BaseType<ZodUnionDef>)._def.options.every((
            { _def },
          ) => _def.typeName === 'ZodString')
      ) {
        body = await resolveWithDeadline(this.#r.text(), 2500)
      } else {
        if (
          (options?.transform === true || this.#s?.transform === true) &&
          this.#r.headers.get('content-type') === 'multipart/form-data'
        ) {
          const formData = await resolveWithDeadline(this.#r.formData(), 2500)

          body = {} as Record<string, unknown>

          for (const [key, value] of formData.entries()) {
            body[key] = value
          }
        } else {
          body = await resolveWithDeadline(this.#r.json(), 2500)
        }
      }
    } catch (err: unknown) {
      throw this.#e(
        err instanceof DeadlineError ? 'Content Too Large' : 'Bad Request',
      )
    }

    const result = this.#s.body.safeParse(body)

    if (!result.success) {
      throw this.#e('Bad Request')
    }

    return result.data
  }

  /**
   * The validated cookies of the incoming request.
   */
  get cookies(): [ValidatedCookies] extends [never] ? never
    : Static<ValidatedCookies> {
    if (this.#c || !this.#s?.cookies) {
      return this.#c as [ValidatedCookies] extends [never] ? never
        : Static<ValidatedCookies>
    }

    try {
      const header = this.#r.headers.get('cookies') ?? ''

      if (header.length > 1000) {
        throw this.#e('Content Too Large')
      }

      this.#c = header
        .split(/;\s*/)
        .map((pair) => pair.split(/=(.+)/))
        .reduce((acc: Record<string, string>, [k, v]) => {
          acc[k] = v

          return acc
        }, {})

      delete this.#c['']
    } catch (_err) {
      this.#c = {}
    }

    const isValid = this.#s.cookies.safeParse(this.#c).success

    if (!isValid) {
      throw this.#e('Bad Request')
    }

    return this.#c as [ValidatedCookies] extends [never] ? never
      : Static<ValidatedCookies>
  }

  /**
   * The validated headers of the incoming request.
   */
  get headers(): [ValidatedHeaders] extends [never]
    ? Record<string, string | undefined>
    : Static<ValidatedHeaders> {
    if (this.#h) {
      return this.#h as [ValidatedHeaders] extends [never]
        ? Record<string, string | undefined>
        : Static<ValidatedHeaders>
    }

    this.#h = {}

    let num = 0

    for (const [key, value] of this.#r.headers) {
      if (num === 50) {
        break
      }

      if (!this.#h[key.toLowerCase()]) {
        this.#h[key.toLowerCase()] = value
      }

      num++
    }

    if (this.#s?.headers) {
      const isValid = this.#s.headers.safeParse(this.#h).success

      if (!isValid) {
        throw this.#e('Bad Request')
      }
    }

    return this.#h as [ValidatedHeaders] extends [never]
      ? Record<string, string | undefined>
      : Static<ValidatedHeaders>
  }

  /**
   * The validated query parameters of the incoming request.
   */
  get query(): [ValidatedQuery] extends [never] ? Record<string, unknown>
    : Static<ValidatedQuery> {
    if (this.#q) {
      return this.#q as [ValidatedQuery] extends [never]
        ? Record<string, unknown>
        : Static<ValidatedQuery>
    }

    this.#q = {}

    if (this.#a.request.querystring) {
      const arr = this.#a.request.querystring.split('&')

      for (let i = 0; i < arr.length; i++) {
        const [key, value] = arr[i].split('=')

        if (!key) {
          continue
        }

        if (typeof value === 'undefined') {
          this.#q[key] = true

          continue
        }

        try {
          this.#q[key] = JSON.parse(decodeURIComponent(value))
        } catch (_err) {
          this.#q[key] = decodeURIComponent(value)
        }
      }
    }

    if (this.#s?.query) {
      const isValid = this.#s.query.safeParse(this.#q).success

      if (!isValid) {
        throw this.#e('Bad Request')
      }
    }

    return this.#q as [ValidatedQuery] extends [never] ? Record<string, unknown>
      : Static<ValidatedQuery>
  }

  /**
   * Parse the request body as an `ArrayBuffer` with a set time limit in ms.
   *
   * @param deadline (default `2500`)
   */
  async blob(deadline = 2500) {
    try {
      const promise = this.#r.blob()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as an `ArrayBuffer` with a set time limit in ms.
   *
   * @param deadline (default `2500`)
   */
  async buffer(deadline = 2500) {
    try {
      const promise = this.#r.arrayBuffer()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as JSON with a set time limit in ms.
   *
   * **If you have defined a validation schema, use `c.req.body()` instead!**
   *
   * @param deadline (default `2500`)
   */
  async json(deadline = 2500): Promise<unknown> {
    try {
      const promise = this.#r.json()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as a `FormData` object with a set time limit in ms.
   *
   * @param deadline (default `2500`)
   */
  async formData(deadline = 2500) {
    try {
      const promise = this.#r.formData()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * Parse the request body as a `string` with a set time limit in ms.
   *
   * **If you have defined a validation schema, use `c.req.body()` instead!**
   *
   * @param deadline (default `2500`)
   */
  async text(deadline = 2500) {
    try {
      const promise = this.#r.text()

      return await resolveWithDeadline(promise, deadline)
    } catch (_err) {
      return null
    }
  }

  /**
   * A readable stream of the request body.
   */
  get stream() {
    return this.#r.body
  }
}
