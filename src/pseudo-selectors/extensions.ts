import { type PseudoSelector, parse, type Selector } from "css-what";
import { cacheResult } from "../helpers/cache.js";
import type {
    CompiledQuery,
    InternalOptions,
    PseudoExtension,
} from "../types.js";
import { aliases } from "./aliases.js";
import { filters } from "./filters.js";
import { pseudos } from "./pseudos.js";
import { subselects } from "./subselects.js";

export type {
    PseudoExtension,
    PseudoExtensionArgumentType,
} from "../types.js";

/** Options for {@link registerPseudo}. */
export interface RegisterPseudoOptions {
    /**
     * Allow replacing an existing pseudo-class of the same name (a built-in
     * pseudo-class or a previously registered extension).
     *
     * Without this, registering a name that already exists throws at
     * registration time.
     * @default false
     */
    override?: boolean;
}

/**
 * Registered pseudo-class extensions, keyed by lower-cased name.
 *
 * The registry is module-level so that extensions registered once are
 * available for every compiled selector.
 */
const extensions = new Map<string, PseudoExtension<unknown, unknown>>();

/**
 * Register a user-defined pseudo-class.
 *
 * Pseudo-classes are registered explicitly: missing arguments and argument
 * types are checked when a selector is compiled, and the matcher is never
 * called during compilation.
 *
 * Registering a pseudo-class with the same name as a built-in or a previously
 * registered extension requires `{ override: true }`.
 * @param extension The pseudo-class to register.
 * @param options Registration options. Pass `{ override: true }` to replace an
 *  existing pseudo-class of the same name.
 */
export function registerPseudo<Node, ElementNode extends Node>(
    extension: PseudoExtension<Node, ElementNode>,
    options?: RegisterPseudoOptions,
): void {
    if (
        typeof extension.name !== "string" ||
        extension.name.trim().length === 0
    ) {
        throw new Error("Pseudo extension must have a non-empty name");
    }

    if (typeof extension.match !== "function") {
        throw new TypeError(
            `Pseudo-class :${extension.name} must provide a match function`,
        );
    }

    const argumentTypes = ["string", "selector"];

    if (
        extension.argument !== undefined &&
        !argumentTypes.includes(extension.argument)
    ) {
        throw new TypeError(
            `Pseudo-class :${extension.name} has an invalid argument type; expected "string" or "selector"`,
        );
    }

    const name = extension.name.toLowerCase();

    if (
        (extensions.has(name) || isBuiltinPseudo(name)) &&
        options?.override !== true
    ) {
        throw new Error(
            `Pseudo-class :${name} already exists; pass { override: true } to replace it`,
        );
    }

    extensions.set(name, extension as PseudoExtension<unknown, unknown>);
}

/**
 * Unregister a previously registered pseudo-class.
 * @param name Name of the pseudo-class, without the leading colon.
 * @returns Whether a pseudo-class was removed.
 */
export function unregisterPseudo(name: string): boolean {
    return extensions.delete(name.toLowerCase());
}

/**
 * Get a registered pseudo-class by name.
 * @param name Name of the pseudo-class, without the leading colon.
 * @internal
 */
export function getRegisteredPseudo(
    name: string,
): PseudoExtension<unknown, unknown> | undefined {
    return extensions.get(name);
}

/**
 * Whether `name` refers to a built-in pseudo-class.
 * @param name Name of the pseudo-class, without the leading colon.
 * @internal
 */
export function isBuiltinPseudo(name: string): boolean {
    return (
        name in filters ||
        name in pseudos ||
        name in subselects ||
        name in aliases
    );
}

/**
 * Compile a registered pseudo-class extension into an executable query.
 *
 * All checks (required arguments, argument types, selector parsing) happen at
 * compile time; the matcher is only called when the returned query is
 * executed against an element.
 * @param next Matcher to run after this matcher succeeds.
 * @param selector Selector used to match elements.
 * @param extension Registered pseudo-class extension to compile.
 * @param options Options that control this operation.
 * @internal
 */
export function compileExtension<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    selector: PseudoSelector,
    extension: PseudoExtension<Node, ElementNode>,
    options: InternalOptions<Node, ElementNode>,
): CompiledQuery<ElementNode> {
    const { name, data } = selector;
    const {
        required = false,
        argument = "string",
        cacheable = false,
        match,
    } = extension;

    // Compile-time check: a required argument must be present.
    if (required && data == null) {
        throw new Error(`Pseudo-class :${name} requires an argument`);
    }

    // Compile-time check: the argument must have the declared type.
    let parsedData: string | Selector[][] | null = data;

    if (argument === "selector") {
        if (typeof data === "string") {
            /*
             * Parse with css-what, the original parser; parse errors (e.g. an
             * unknown nested pseudo-class) are reported at compile time.
             */
            try {
                parsedData = parse(data);
            } catch (error) {
                throw new Error(
                    `Pseudo-class :${name}: ${(error as Error).message}`,
                    { cause: error },
                );
            }
        } else if (data != null && !Array.isArray(data)) {
            throw new TypeError(
                `Pseudo-class :${name} requires a selector argument`,
            );
        }
    } else if (data != null && typeof data !== "string") {
        throw new Error(`Pseudo-class :${name} requires a string argument`);
    }

    const matches = (element: ElementNode): boolean =>
        match(element, parsedData, options);

    // Only pure (cacheable) extensions have their results cached.
    return cacheable
        ? cacheResult(next, options, matches)
        : (element) => next(element) && matches(element);
}
