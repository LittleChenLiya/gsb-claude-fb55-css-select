/**
 * Example: registering custom pseudo-classes with css-select.
 *
 * Build the library first, then run this file with Node:
 *
 *   npm run build
 *   node examples/custom-pseudos.mjs
 *
 * The example registers two pseudo-classes:
 *
 * 1. `:starts-with(prefix)` - a pure string-argument pseudo-class. Its
 *    argument is required and its result only depends on the element, so it
 *    is marked as cacheable.
 * 2. `:matches-any(selector)` - a selector-argument pseudo-class. Its
 *    argument is parsed with css-what at compile time and the parsed
 *    selector is passed to the matcher. It is also pure, so cacheable.
 */
import { getText } from "domutils";
import { parseDocument } from "htmlparser2";
import * as CSSselect from "../dist/index.js";

// 1. A pure string-argument pseudo-class: `:starts-with(prefix)`.
CSSselect.registerPseudo({
    name: "starts-with",
    required: true,
    cacheable: true,
    match(element, prefix) {
        return getText(element).startsWith(prefix);
    },
});

// 2. A selector-argument pseudo-class: `:matches-any(selector)`.
CSSselect.registerPseudo({
    name: "matches-any",
    required: true,
    argument: "selector",
    cacheable: true,
    match(element, selector, options) {
        return selector != null && CSSselect.is(element, selector, options);
    },
});

const dom = parseDocument(
    "<div><p>Hello world</p><p>Hi there</p><span>Hello again</span></div>",
);

console.log("elements starting with 'Hello':");
for (const element of CSSselect.selectAll(":starts-with(Hello)", dom)) {
    console.log("  -", getText(element));
}

console.log("elements matching `p, span`:");
for (const element of CSSselect.selectAll(":matches-any(p, span)", dom)) {
    console.log("  -", getText(element));
}

/*
 * Compile-time checks: missing required arguments throw while compiling,
 * before any query is run.
 */
try {
    CSSselect.compile(":starts-with");
} catch (error) {
    console.log("compile-time error:", error.message);
}

// Same-name overrides require explicit authorization.
try {
    CSSselect.registerPseudo({
        name: "starts-with",
        match: () => false,
    });
} catch (error) {
    console.log("override error:", error.message);
}

// The matcher is never called during compilation.
let calls = 0;
CSSselect.registerPseudo({
    name: "count-calls",
    cacheable: true,
    match(element) {
        calls += 1;
        return getText(element).length > 0;
    },
});
const query = CSSselect.compile(":count-calls");
console.log("matcher calls during compilation:", calls);
CSSselect.selectAll(query, dom);
console.log("matcher calls after one query:", calls);
CSSselect.selectAll(query, dom);
console.log("matcher calls after two queries (cached):", calls);
