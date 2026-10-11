import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { component, handleAction, resource, serverAction, suspense } from '@purityjs/core';
import { flattenValue, valueText } from '@purityjs/core/compiler';
import { chromium, firefox, webkit } from 'playwright';
import {
  generate,
  generateHydrate,
  generateSSR,
  isSSRHtml,
  markSSRHtml,
  parse,
  valueToHtml,
} from '@purityjs/core/compiler';
import {
  html,
  renderStatic,
  renderToStream,
  renderToStreamResponse,
  renderToString,
} from '@purityjs/ssr';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

let writes = 0;
let cookieSeen = false;
serverAction('/account', () => {
  writes++;
  return new Response('Account changed');
});
// An intentionally minimal consumer of handleAction(), without an adapter
// origin filter, proves that the framework dispatcher owns this boundary.
const victim = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<form method="post" action="/account"><button>Submit</button></form>');
    return;
  }
  req.resume();
  cookieSeen = req.headers.cookie?.includes('session=victim') ?? false;
  const request = new Request(`${victimOrigin}${req.url}`, {
    method: 'POST',
    headers: req.headers as HeadersInit,
  });
  void handleAction(request)
    .then(async (response) => {
      assert.ok(response);
      res.statusCode = response.status;
      res.end(await response.text());
    })
    .catch((error: unknown) => {
      console.error(error);
      res.statusCode = 500;
      res.end('Test server failed');
    });
});
const victimOrigin = await listen(victim);
const attacker = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<form method="post" action="${victimOrigin}/account"><button>Submit</button></form>`);
});
const attackerOrigin = await listen(attacker);

try {
  const doctypeControls: string[] = [];
  const cjsSSR = createRequire(import.meta.url)('@purityjs/ssr') as typeof import('@purityjs/ssr');
  for (const runtime of [
    { html, renderStatic, renderToStream, renderToStreamResponse, renderToString },
    cjsSSR,
  ]) {
    for (const mode of ['buffered', 'direct', 'prepared', 'static-body', 'static-shell'] as const) {
      let viewCalls = 0;
      const render = async (doctype: string, nonce?: string) => {
        const view = () => {
          viewCalls++;
          return runtime.html`<main>DOCTYPE-SAFE</main>`;
        };
        if (mode === 'buffered') return runtime.renderToString(view, { doctype, nonce });
        if (mode === 'static-body' || mode === 'static-shell') {
          const result = await runtime.renderStatic({
            routes: ['/'],
            handler: () => view,
            doctype,
            renderOptions: { nonce },
            shellTemplate:
              mode === 'static-shell' ? '<html><body>{{body}}</body></html>' : undefined,
          });
          assert.equal(result.errors.size, 0);
          return result.files.get('/')!;
        }
        const body =
          mode === 'direct'
            ? runtime.renderToStream(view, { doctype, nonce })
            : (await runtime.renderToStreamResponse(view, { doctype, nonce })).body;
        return new Response(body).text();
      };
      await assert.rejects(
        render('<!doctype html><script>globalThis.__purityDoctypeAttack=1</script>'),
        /invalid doctype/,
      );
      assert.equal(viewCalls, 0, 'Invalid options must not start user code');
      for (const field of ['doctype', 'nonce'] as const) {
        let coercions = 0;
        const value = {
          [Symbol.toPrimitive]() {
            return ++coercions === 1
              ? field === 'doctype'
                ? '<!doctype html>'
                : 'safe_nonce'
              : '<script>globalThis.__purityDoctypeAttack=1</script>';
          },
        } as unknown as string;
        await assert.rejects(
          field === 'doctype' ? render(value) : render('<!doctype html>', value),
          field === 'doctype' ? /invalid doctype/ : /invalid CSP nonce/,
        );
        assert.equal(coercions, 0, 'Reject objects before coercion');
        assert.equal(viewCalls, 0, 'Invalid options must not start user code');
      }
      const output = await render('<!DoCtYpE html>');
      assert.ok(output.startsWith('<!DoCtYpE html>'));
      doctypeControls.push(output);
    }
  }

  for (const compile of [generate, generateHydrate, generateSSR]) {
    assert.throws(() => compile(parse(['<script>', '</script>'])), /Unsafe dynamic binding/);
    assert.throws(() => compile(parse(['<script .text=', '></script>'])), /Unsafe dynamic binding/);
  }
  await assert.rejects(
    renderToString(() => html`<script>${'\nglobalThis.__purityAttack=1\n'}</script>`),
    /Unsafe dynamic binding/,
  );
  await assert.rejects(
    new Response(
      renderToStream(() => html`<script>${'\nglobalThis.__purityAttack=1\n'}</script>`),
    ).text(),
    /Unsafe dynamic binding/,
  );

  const payload = '<script>globalThis.__purityAttack=1</script>';
  const forged = JSON.parse(JSON.stringify({ __purity_ssr_html__: payload }));
  const markup = await renderToString(
    () => html`<main>${forged}${html`<strong>safe</strong>`}</main>`,
  );
  assert.ok(!markup.includes(payload));
  const stream = await new Response(renderToStream(() => html`<main>${forged}</main>`)).text();
  assert.ok(!stream.includes(payload));

  // Both package formats must reject structural impersonation and retain their
  // own explicitly trusted wrappers. Trust does not come from serialization.
  const cjs = createRequire(import.meta.url)('@purityjs/core/compiler') as {
    isSSRHtml: typeof isSSRHtml;
    markSSRHtml: typeof markSSRHtml;
    valueToHtml: typeof valueToHtml;
  };
  for (const runtime of [{ isSSRHtml, markSSRHtml, valueToHtml }, cjs]) {
    assert.equal(runtime.isSSRHtml(forged), false);
    assert.equal(runtime.valueToHtml(forged), '[object Object]');
    assert.equal(
      runtime.valueToHtml(runtime.markSSRHtml('<strong>safe</strong>')),
      '<strong>safe</strong>',
    );
  }

  const ast = parse(['<a href=', '>go</a>']);
  const client = generate(ast);
  const hydrate = generateHydrate(ast);
  const inlinePayload = '</script><script>globalThis.__purityLiteralAttack=1</script><!--';
  const inlineFactory = generate(parse([`<p title="${inlinePayload}">`, '</p>']));
  // Generated client code takes the coercion helpers as free names; the page
  // rebuilds them from the same source the core runtime uses.
  const helperSource = `(function(){const flattenValue=${flattenValue.toString()};const valueText=${valueText.toString()};return {flattenValue,valueText};})()`;
  const foreignTemplates = ['svg', 'math'].map((tag) =>
    generate(parse([`<${tag}><template>x</template></${tag}>`])),
  );
  const rawStreamMarkup = await new Response(
    renderToStream(
      () =>
        html`<textarea>${suspense(
          () => {
            const data = resource(() => Promise.resolve('<READY>'));
            return html`<span>${() => data()}</span>`;
          },
          () => html`<span>RAW-FALLBACK</span>`,
        )}</textarea><section id="stream-sibling">${suspense(
          () => html`<b>SIBLING-READY</b>`,
          () => html`<b>SIBLING-FALLBACK</b>`,
        )}</section>`,
      { serializeResources: false },
    ),
  ).text();
  const rawCases: {
    client: string;
    hydrate: string;
    markup: string;
    tag: string;
    expected: string;
    values?: string[];
  }[] = [];
  for (const outer of ['svg', 'math']) {
    for (const tag of ['input', 'area', 'source', 'link', 'track', 'wbr']) {
      const strings = [
        `<${outer}><${tag}><circle>`,
        `</circle></${tag}><circle>tail</circle></${outer}>`,
      ];
      const tree = parse(strings);
      rawCases.push({
        client: generate(tree),
        hydrate: generateHydrate(tree),
        markup: await renderToString(() =>
          html(strings as unknown as TemplateStringsArray, 'kept'),
        ),
        tag: 'circle',
        expected: 'kept',
        values: ['kept'],
      });
    }
    const strings = [`<${outer}>before<![CDATA[<b>x</b>&\r\ny>]]>after</${outer}><p>`, '</p>'];
    const tree = parse(strings);
    rawCases.push({
      client: generate(tree),
      hydrate: generateHydrate(tree),
      markup: await renderToString(() => html(strings as unknown as TemplateStringsArray, 'tail')),
      tag: outer,
      expected: 'before<b>x</b>&\ny>after',
      values: ['tail'],
    });
  }
  const foreignRawCases: string[][] = [];
  for (const tag of ['xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']) {
    foreignRawCases.push([
      `<svg><${tag}><foreignObject><style>`,
      `</style></foreignObject></${tag}></svg>`,
    ]);
  }
  for (const outer of ['svg', 'math']) {
    for (const tag of ['p', 'div', 'font color="red"']) {
      foreignRawCases.push([
        `<${outer}><g><${tag}><style>`,
        `</style></${tag.split(' ')[0]}></g></${outer}>`,
      ]);
    }
  }
  for (const strings of foreignRawCases) {
    const tree = parse(strings);
    rawCases.push({
      client: generate(tree),
      hydrate: generateHydrate(tree),
      markup: await renderToString(() =>
        html(strings as unknown as TemplateStringsArray, 'p{color:red}'),
      ),
      tag: 'style',
      expected: 'p{color:red}',
    });
  }
  const svgStrings = [
    '<svg viewbox="0 0 10 10" VIEWBOX="0 0 99 99" preserveaspectratio="none" xml:lang="en" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><lineargradient id="g" gradientunits="userSpaceOnUse" xlink:href="#base"><stop></stop></lineargradient></defs><textpath>x</textpath><foreignobject><div>HTML</div></foreignobject></svg>',
  ];
  const svgStaticCode = generate(parse(svgStrings));
  const svgStaticMarkup = await renderToString(() =>
    html(svgStrings as unknown as TemplateStringsArray),
  );
  for (const glyph of ['mglyph', 'malignmark']) {
    for (const parent of ['annotation-xml encoding="text/html"', 'mtext']) {
      const strings = [
        `<math><${parent}><${glyph}><style>`,
        `</style></${glyph}></${parent.split(' ')[0]}></math>`,
      ];
      const tree = parse(strings);
      rawCases.push({
        client: generate(tree),
        hydrate: generateHydrate(tree),
        markup: await renderToString(() =>
          html(strings as unknown as TemplateStringsArray, 'p{color:red}'),
        ),
        tag: 'style',
        expected: 'p{color:red}',
      });
    }
  }
  for (const tag of ['textarea', 'title']) {
    const strings = [`<div><${tag}>a\rb\r\nc</${tag}><p>`, '</p></div>'];
    const tree = parse(strings);
    rawCases.push({
      client: generate(tree),
      hydrate: generateHydrate(tree),
      markup: await renderToString(() => html(strings as unknown as TemplateStringsArray, 'x')),
      tag,
      expected: 'a\rb\r\nc',
    });
  }
  component(
    'browser-light-text-1',
    (_props, { default: body }) => html`<b>shadow</b>${body()}${body()}`,
  );
  const lightMarkup = await renderToString(
    () =>
      html`<textarea>${html`<browser-light-text-1><p>x</p><style>${'p{content:"\\3c <i>"}'}</style></browser-light-text-1>`}</textarea>`,
  );
  const deep = (depth: number): unknown =>
    depth
      ? suspense(
          () => deep(depth - 1),
          () => html`<b>fallback</b>`,
        )
      : html`<b>READY</b>`;
  const deepMarkup = await new Response(
    renderToStream(() => html`<textarea>${deep(12)}</textarea>`, { serializeResources: false }),
  ).text();
  for (const browserType of [chromium, firefox, webkit]) {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage();
      const foreignResult = await page.evaluate(
        (codes) =>
          codes.map((code) => {
            const render = new Function(`return ${code}`)() as () => DocumentFragment;
            const root = render().firstChild as Element;
            const child = root.firstChild as Element;
            return [root.namespaceURI, child.namespaceURI, root.textContent];
          }),
        foreignTemplates,
      );
      assert.deepEqual(foreignResult, [
        ['http://www.w3.org/2000/svg', 'http://www.w3.org/2000/svg', 'x'],
        ['http://www.w3.org/1998/Math/MathML', 'http://www.w3.org/1998/Math/MathML', 'x'],
      ]);
      const svgNames = await page.evaluate(
        ({ code, markup }) => {
          const client = new Function(`return ${code}`)()() as DocumentFragment;
          const server = document.createElement('div');
          server.innerHTML = markup;
          return [client, server].map((root) => [
            root.querySelector('#g')?.localName,
            root.querySelector('#g')?.constructor.name,
            root.querySelector('textPath')?.localName,
            root.querySelector('foreignObject')?.localName,
            root.querySelector('div')?.namespaceURI,
            root.querySelector('svg')?.getAttribute('viewBox'),
            root.querySelector('svg')?.getAttribute('preserveAspectRatio'),
            root
              .querySelector('svg')
              ?.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang'),
            root.querySelector('svg')?.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink'),
            root.querySelector('#g')?.getAttribute('gradientUnits'),
            root.querySelector('#g')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
          ]);
        },
        { code: svgStaticCode, markup: svgStaticMarkup },
      );
      assert.deepEqual(
        svgNames,
        Array(2).fill([
          'linearGradient',
          'SVGLinearGradientElement',
          'textPath',
          'foreignObject',
          'http://www.w3.org/1999/xhtml',
          '0 0 10 10',
          'none',
          'en',
          'http://www.w3.org/1999/xlink',
          'userSpaceOnUse',
          '#base',
        ]),
      );
      await page.setContent(rawStreamMarkup);
      assert.equal(await page.locator('textarea').textContent(), '<READY>');
      assert.equal(await page.locator('#stream-sibling').textContent(), 'SIBLING-READY');
      for (const fixture of rawCases) {
        const result = await page.evaluate(
          ({ fixture, helpers }) => {
            const H = new Function(`return ${helpers}`)() as {
              flattenValue: unknown;
              valueText: unknown;
            };
            const bind = (code: string) =>
              new Function('__purity_fl__', '__purity_tx__', `return ${code}`)(
                H.flattenValue,
                H.valueText,
              );
            const immediate = (fn: () => void) => fn();
            const values = fixture.values ?? [fixture.tag === 'style' ? 'p{color:red}' : 'x'];
            const client = bind(fixture.client)(values, immediate) as DocumentFragment;
            const host = document.createElement('div');
            host.innerHTML = fixture.markup;
            const adopted = host.querySelector(fixture.tag);
            const before = adopted?.textContent;
            bind(fixture.hydrate)(values, immediate, host);
            return [
              client.querySelector(fixture.tag)?.textContent,
              before,
              host.querySelector(fixture.tag)?.textContent,
              adopted === host.querySelector(fixture.tag),
            ];
          },
          { fixture, helpers: helperSource },
        );
        assert.deepEqual(result, [fixture.expected, fixture.expected, fixture.expected, true]);
      }
      await page.setContent(lightMarkup);
      assert.equal(await page.locator('textarea').textContent(), 'xp{content:"\\3c <i>"}');
      await page.setContent(deepMarkup);
      assert.equal(await page.locator('textarea').textContent(), 'READY');
      for (const output of doctypeControls) {
        await page.setContent(output);
        assert.equal(await page.locator('main').textContent(), 'DOCTYPE-SAFE');
        assert.equal(
          await page.evaluate(
            () => (globalThis as { __purityDoctypeAttack?: number }).__purityDoctypeAttack,
          ),
          undefined,
        );
      }
      await page.setViewportSize({ width: 500, height: 400 });
      for (const comparison of ['< 600px', '<600px', '<=600px']) {
        const strings = [
          `<style>@media (width ${comparison}) { #css-range { color: `,
          ' } }</style><p id="css-range">Range comparison</p>',
        ] as unknown as TemplateStringsArray;
        const output = await renderToString(() => html(strings, 'rgb(255, 0, 0)'));
        await page.setContent(output);
        assert.equal(
          await page.locator('#css-range').evaluate((node) => getComputedStyle(node).color),
          'rgb(255, 0, 0)',
          `${browserType.name()}: CSS range comparison ${comparison} must apply before hydration`,
        );
      }
      await page.setContent(markup);
      assert.equal(
        await page.evaluate(() => (globalThis as { __purityAttack?: number }).__purityAttack),
        undefined,
      );
      assert.equal(await page.locator('strong').textContent(), 'safe');
      await page.setContent(
        `<script>globalThis.__purityHelpers=${helperSource};globalThis.__purityInlineFactory=(function(__purity_fl__,__purity_tx__){return ${inlineFactory};})(__purityHelpers.flattenValue,__purityHelpers.valueText);</script>`,
      );
      assert.equal(
        await page.evaluate(
          () => (globalThis as { __purityLiteralAttack?: number }).__purityLiteralAttack,
        ),
        undefined,
      );
      const literalTitle = await page.evaluate(() => {
        const render = (
          globalThis as {
            __purityInlineFactory?: (
              values: unknown[],
              watch: (fn: () => void) => void,
            ) => HTMLElement;
          }
        ).__purityInlineFactory;
        if (!render) throw new Error('Inline factory was not installed');
        return render(['safe'], (fn) => fn()).getAttribute('title');
      });
      assert.equal(literalTitle, inlinePayload);
      const result = await page.evaluate(
        ({ client, hydrate, helpers }) => {
          const immediate = (fn: () => void) => fn();
          const H = new Function(`return ${helpers}`)() as {
            flattenValue: unknown;
            valueText: unknown;
          };
          const bind = (code: string) =>
            new Function('__purity_fl__', '__purity_tx__', `return ${code}`)(
              H.flattenValue,
              H.valueText,
            );
          const dom = bind(client);
          const adopt = bind(hydrate);
          let rejected = 0;
          for (const value of [
            'javascript:globalThis.__purityAttack=1',
            'java\nscript:globalThis.__purityAttack=1',
            'data:text/html,<script>attack()</script>',
          ]) {
            for (const render of [
              () => dom([value], immediate),
              () => {
                const root = document.createElement('div');
                root.innerHTML = '<a href="/safe">go</a>';
                adopt([value], immediate, root);
              },
            ]) {
              try {
                render();
              } catch (error) {
                if (error instanceof Error && error.message.includes('Unsafe URL binding'))
                  rejected++;
                else throw error;
              }
            }
          }
          const root = dom(['/safe'], immediate) as DocumentFragment;
          return {
            rejected,
            safeHref: (root as unknown as HTMLAnchorElement).getAttribute('href'),
          };
        },
        { client, hydrate, helpers: helperSource },
      );
      assert.deepEqual(result, { rejected: 6, safeHref: '/safe' });
      console.log(
        `${browserType.name()}: forged SSR markup blocked; nested markup retained; unsafe DOM/hydration URLs rejected`,
      );
      for (const javaScriptEnabled of [false, true]) {
        const context = await browser.newContext({ javaScriptEnabled });
        try {
          await context.addCookies([
            {
              name: 'session',
              value: 'victim',
              url: victimOrigin,
              httpOnly: true,
              sameSite: 'Strict',
            },
          ]);
          const formPage = await context.newPage();
          writes = 0;
          cookieSeen = false;
          await formPage.goto(attackerOrigin);
          const [blocked] = await Promise.all([
            formPage.waitForResponse((response) => response.url() === `${victimOrigin}/account`),
            // Response headers can arrive before WebKit commits the form
            // navigation. Finish it before starting the same-origin control.
            formPage.waitForURL(`${victimOrigin}/account`, { waitUntil: 'load' }),
            formPage.getByRole('button', { name: 'Submit' }).click(),
          ]);
          assert.equal(blocked.status(), 403);
          assert.equal(cookieSeen, true, 'Attack must include a real session cookie');
          assert.equal(writes, 0, 'Cross-origin form must not reach the mutation');
          await formPage.goto(victimOrigin);
          const [accepted] = await Promise.all([
            formPage.waitForResponse((response) => response.url() === `${victimOrigin}/account`),
            formPage.waitForURL(`${victimOrigin}/account`, { waitUntil: 'load' }),
            formPage.getByRole('button', { name: 'Submit' }).click(),
          ]);
          assert.equal(accepted.status(), 200);
          assert.equal(writes, 1);
          console.log(
            `${browserType.name()}: cookie-bearing cross-origin form blocked; same-origin form accepted (JS=${javaScriptEnabled})`,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await close(attacker);
  await close(victim);
}
