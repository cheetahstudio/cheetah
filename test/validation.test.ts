// Copyright 2023 Samuel Kopp. All rights reserved. Apache-2.0 license.
import { assertEquals } from 'std/assert/mod.ts'
import { z } from 'zod'
import cheetah from '../mod.ts'

Deno.test('Validation', async (t) => {
  await t.step('transform', async () => {
    const app = new cheetah()

    app.post('/transform', {
      body: z.object({
        message: z.string(),
      }),
    }, async (c) => {
      assertEquals(await c.req.body({ transform: true }), {
        message: 'Hello World',
      })

      return 'test'
    })

    const form = new FormData()
    form.append('message', 'Hello World')
    await (await app.fetch(
      new Request('http://localhost/transform', {
        method: 'POST',
        body: form,
      }),
    )).text()

    await (await app.fetch(
      new Request('http://localhost/transform', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello World' }),
      }),
    )).text()
  })

  await t.step('cookies', async () => {
    const app = new cheetah()

    app.get('/cookies', {
      cookies: z.object({ custom: z.string().min(4).max(16) }).strict(),
    }, (c) => {
      return c.req.cookies
    })

    assertEquals(
      (await app.fetch(
        new Request('http://localhost/cookies', {
          headers: { cookies: 'custom=test;' },
        }),
      )).status,
      200,
    )
    assertEquals(
      (await app.fetch(
        new Request('http://localhost/cookies', {
          headers: { cookie: 'custom=te;' },
        }),
      )).status,
      400,
    )
    assertEquals(
      (await app.fetch(
        new Request('http://localhost/cookies', {
          headers: { cookie: 'invalid=abc;' },
        }),
      )).status,
      400,
    )
    assertEquals(
      (await app.fetch(
        new Request('http://localhost/cookies', {
          headers: { cookie: 'custom=test; another=cookie;' },
        }),
      )).status,
      400,
    )
  })

  await t.step('headers', async () => {
    const app = new cheetah()

    app.get(
      '/headers',
      { headers: z.object({ custom: z.string().email() }) },
      (c) => {
        return c.req.headers
      },
    )

    const res1 = await app.fetch(
      new Request('http://localhost/headers', {
        headers: { random: 'bullshit' },
      }),
    )
    const res2 = await app.fetch(
      new Request('http://localhost/headers', {
        headers: { random: 'bullshit', custom: 'tes@t' },
      }),
    )
    const res3 = await app.fetch(
      new Request('http://localhost/headers', {
        headers: { custom: '' },
      }),
    )
    const res4 = await app.fetch(
      new Request('http://localhost/headers', {
        headers: { custom: 'test@email.com' },
      }),
    )

    assertEquals(res1.status, 400)
    assertEquals(res2.status, 400)
    assertEquals(res3.status, 400)
    assertEquals(res4.status, 200)
    assertEquals(await res4.json(), { custom: 'test@email.com' })
  })

  await t.step('query', async () => {
    const app = new cheetah()

    app.get('/query', {
      query: z.object({
        first: z.string().optional(),
        second: z.boolean(),
        third: z.number(),
      }),
    }, (c) => {
      const d = c.req.query

      d.first

      return c.req.query
    })

    assertEquals(
      (await app.fetch(
        new Request('http://localhost/query?first=test&second&third=69'),
      )).status,
      200,
    )
    assertEquals(
      (await app.fetch(
        new Request('http://localhost/query?second=false&third=e9'),
      )).status,
      400,
    )
    assertEquals(
      (await app.fetch(
        new Request('http://localhost/query?second=false&third=69'),
      )).status,
      200,
    )
  })

  await t.step('query (no schema)', async () => {
    const app = new cheetah()

    app.get('/query', (c) => {
      const d = c.req.query

      d.lol
      return d
    })

    assertEquals(
      await (await app.fetch(
        new Request('http://localhost/query?first=test&second&third=69'),
      )).json(),
      { first: 'test', second: true, third: 69 },
    )
    assertEquals(
      await (await app.fetch(
        new Request('http://localhost/query?second=false&third=e9'),
      )).json(),
      { second: false, third: 'e9' },
    )
    assertEquals(
      await (await app.fetch(
        new Request('http://localhost/query?second=false&third=69'),
      )).json(),
      { second: false, third: 69 },
    )
  })

  await t.step('params', async () => {
    const app = new cheetah()

    app.get(
      '/animals/:name',
      {
        params: {
          name: z.union([z.literal('cat'), z.literal('dog')]),
        },
      },
      (c) => {
        return c.req.param('name')
      },
    )

    const res1 = await app.fetch(
      new Request('http://localhost/animals/cat'),
    )

    assertEquals(res1.status, 200)

    const res2 = await app.fetch(
      new Request('http://localhost/animals/dog'),
    )

    assertEquals(res2.status, 200)

    const res3 = await app.fetch(
      new Request('http://localhost/animals/rabbit'),
    )

    assertEquals(res3.status, 400)
  })
})
