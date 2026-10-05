import {
    type PseudoSelector,
    parse,
    type Selector,
    SelectorType,
} from "css-what";
import { copyOptions } from "../helpers/options.js";
import type {
    CompiledQuery,
    CompileToken,
    InternalOptions,
    PseudoExtension,
} from "../types.js";
import { aliases } from "./aliases.js";
import { filters } from "./filters.js";
import { pseudos } from "./pseudos.js";
import { subselects } from "./subselects.js";

const ARGUMENT_MODES = new Set(["none", "optional", "required"]);
const ARGUMENT_TYPES = new Set(["string", "selector"]);

/**
 * Get the effective argument mode of an extension.
 * @param extension The extension declaration.
 */
function getArgumentMode<Node, ElementNode extends Node>(
    extension: PseudoExtension<Node, ElementNode>,
): string {
    return (
        extension.argument ??
        (extension.argumentType === "selector" ? "required" : "none")
    );
}

/**
 * Whether a pseudo-class name is already taken by a built-in pseudo-class or
 * a legacy `pseudos` entry.
 * @param name The pseudo-class name to check.
 * @param options The normalized options, including legacy `pseudos`.
 */
function isTakenPseudoName<Node, ElementNode extends Node>(
    name: string,
    options: InternalOptions<Node, ElementNode>,
): boolean {
    return (
        name in subselects ||
        name in aliases ||
        name in filters ||
        name in pseudos ||
        (options.pseudos != null && name in options.pseudos)
    );
}

/**
 * Validate all registered pseudo-class extensions.
 *
 * Runs when options are normalized, so malformed declarations and
 * unauthorized same-name overrides are rejected before any selector is
 * compiled or matched.
 * @param options The normalized options holding the extension registry.
 */
export function validatePseudoExtensions<Node, ElementNode extends Node>(
    options: InternalOptions<Node, ElementNode>,
): void {
    const { pseudoExtensions } = options;

    if (!pseudoExtensions) return;

    for (const [name, extension] of Object.entries(pseudoExtensions)) {
        if (typeof extension.match !== "function") {
            throw new TypeError(
                `Pseudo-class extension :${name} must declare a match function`,
            );
        }

        const argument = getArgumentMode(extension);

        if (!ARGUMENT_MODES.has(argument)) {
            throw new Error(
                `Pseudo-class extension :${name} has an invalid argument mode; expected "none", "optional" or "required"`,
            );
        }

        const argumentType = extension.argumentType ?? "string";

        if (!ARGUMENT_TYPES.has(argumentType)) {
            throw new Error(
                `Pseudo-class extension :${name} has an invalid argumentType; expected "string" or "selector"`,
            );
        }

        if (argumentType === "selector" && argument === "none") {
            throw new Error(
                `Pseudo-class extension :${name} takes a selector argument, so its argument mode cannot be "none"`,
            );
        }

        if (extension.override !== true && isTakenPseudoName(name, options)) {
            throw new Error(
                `Pseudo-class :${name} is already defined; set the override flag on the extension to replace it`,
            );
        }
    }
}

/**
 * Validate the argument of a single extension pseudo-class usage.
 * @param name The pseudo-class name.
 * @param extension The extension declaration.
 * @param data The parsed argument of the pseudo-class, if any.
 */
export function verifyExtensionArguments<Node, ElementNode extends Node>(
    name: string,
    extension: PseudoExtension<Node, ElementNode>,
    data: PseudoSelector["data"],
): void {
    const argument = getArgumentMode(extension);

    if (data == null) {
        if (argument === "required") {
            throw new Error(`Pseudo-class :${name} requires an argument`);
        }
    } else if (argument === "none") {
        throw new Error(`Pseudo-class :${name} doesn't have any arguments`);
    }
}

/**
 * Validate extension pseudo-classes in a parsed selector before compilation.
 *
 * When the selector source is available, errors are reported with the
 * position of the offending pseudo-class. Nested `:not()` / `:has()` (and
 * other subselect) arguments are still parsed by the original parser and are
 * validated recursively.
 * @param token The parsed selector token.
 * @param options The normalized options holding the extension registry.
 * @param source The selector source, used to report error positions.
 */
export function validateSelectorExtensions<Node, ElementNode extends Node>(
    token: Selector[][],
    options: InternalOptions<Node, ElementNode>,
    source?: string,
): void {
    const extensions = options.pseudoExtensions;

    if (!extensions) return;

    let fromIndex = 0;

    const walk = (selectors: Selector[][]): void => {
        for (const rules of selectors) {
            for (const selector of rules) {
                if (selector.type !== SelectorType.Pseudo) continue;

                let position: number | undefined;

                if (source !== undefined) {
                    const index = source.indexOf(
                        `:${selector.name}`,
                        fromIndex,
                    );

                    if (index !== -1) {
                        position = index;
                        fromIndex = index + selector.name.length + 1;
                    }
                }

                const extension =
                    selector.name in extensions
                        ? extensions[selector.name]
                        : undefined;

                if (extension) {
                    try {
                        verifyExtensionArguments(
                            selector.name,
                            extension,
                            selector.data,
                        );
                    } catch (error) {
                        if (position !== undefined && error instanceof Error) {
                            throw new Error(
                                `${error.message} (at position ${position} in the selector)`,
                                { cause: error },
                            );
                        }
                        throw error;
                    }
                }

                if (Array.isArray(selector.data)) {
                    walk(selector.data);
                }
            }
        }
    };

    walk(token);
}

/**
 * Memoize the results of a pure extension matcher per element.
 *
 * Only used for extensions that declared `pure: true`; impure extensions are
 * never cached.
 * @param next Matcher to run after this matcher succeeds.
 * @param options The normalized options, honoring `cacheResults`.
 * @param options.cacheResults Whether results should be memoized per element.
 * @param matches The pure matcher to memoize.
 */
function cacheElementResults<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    { cacheResults }: InternalOptions<Node, ElementNode>,
    matches: (element: ElementNode) => boolean,
): CompiledQuery<ElementNode> {
    if (cacheResults === false || typeof WeakMap === "undefined") {
        return (element) => matches(element) && next(element);
    }

    // @ts-expect-error `ElementNode` is not extending object
    const resultCache = new WeakMap<ElementNode, boolean>();

    return function cachedExtension(element) {
        if (!next(element)) return false;

        let result = resultCache.get(element);

        if (result === undefined) {
            result = matches(element);
            resultCache.set(element, result);
        }

        return result;
    };
}

/**
 * Compile a registered pseudo-class extension into an executable query.
 *
 * Only declaration data is processed here: the matcher is wrapped, never
 * called, and the DOM is never accessed during compilation.
 * @param next Matcher to run after this matcher succeeds.
 * @param name The pseudo-class name.
 * @param extension The extension declaration.
 * @param data The parsed argument of the pseudo-class, if any.
 * @param options Options that control this operation.
 * @param context Context nodes used to scope selector matching.
 * @param compileToken Function used to compile nested selector tokens.
 */
export function compilePseudoExtension<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    name: string,
    extension: PseudoExtension<Node, ElementNode>,
    data: PseudoSelector["data"],
    options: InternalOptions<Node, ElementNode>,
    context: Node[] | undefined,
    compileToken: CompileToken<Node, ElementNode>,
): CompiledQuery<ElementNode> {
    verifyExtensionArguments(name, extension, data);

    let argument: string | CompiledQuery<ElementNode> | null = data as
        | string
        | null;

    if ((extension.argumentType ?? "string") === "selector" && data != null) {
        // Nested selector arguments are parsed by the original parser.
        const token = Array.isArray(data) ? data : parse(data);
        argument = compileToken(token, copyOptions(options), context);
    }

    const { match } = extension;
    const matches = (element: ElementNode) => match(element, argument, options);

    // Only pure extensions may have their results cached.
    return extension.pure === true
        ? cacheElementResults(next, options, matches)
        : (element) => matches(element) && next(element);
}
