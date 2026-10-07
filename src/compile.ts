import * as boolbase from "boolbase";
import { type Selector, SelectorType } from "css-what";
import { compileGeneralSelector } from "./general.js";
import { getElementParent } from "./helpers/querying.js";
import {
    getQuality,
    includesScopePseudo,
    isTraversal,
    sortRules,
} from "./helpers/selectors.js";
import { PLACEHOLDER_ELEMENT } from "./pseudo-selectors/subselects.js";
import type {
    CompiledQuery,
    InternalOptions,
    InternalSelector,
    Predicate,
} from "./types.js";

/**
 * Error thrown when the compilation of a custom pseudo-class fails.
 *
 * Carries the name of the pseudo-class and its position in the selector
 * (the index of the comma-separated selector group, and the index of the
 * token within that group). The original error is kept as `cause`.
 */
export class PseudoClassCompilationError extends Error {
    /** Name of the custom pseudo-class that failed to compile. */
    pseudoName: string;
    /** Index of the comma-separated selector group containing the failure. */
    groupIndex: number;
    /** Index of the token within its selector group, as written in the selector. */
    tokenIndex: number;

    constructor(
        pseudoName: string,
        groupIndex: number,
        tokenIndex: number,
        cause: Error,
    ) {
        super(
            `Failed to compile custom pseudo-class :${pseudoName} ` +
                `at token ${tokenIndex} of selector group ${groupIndex}: ${cause.message}`,
            { cause },
        );
        this.name = "PseudoClassCompilationError";
        this.pseudoName = pseudoName;
        this.groupIndex = groupIndex;
        this.tokenIndex = tokenIndex;
    }
}

/**
 * Add the selector position and pseudo-class name to errors thrown while
 * compiling a custom pseudo-class. All other errors (including unknown
 * pseudo-classes) are passed through unchanged. Already-wrapped errors are
 * re-thrown as-is, so nested compilations keep the innermost position.
 * @param error Error thrown while compiling the rule.
 * @param rule Selector token that was being compiled.
 * @param options Options that control this operation.
 * @param groupIndex Index of the selector group being compiled.
 * @param tokenIndex Index of the token within the group.
 */
function addCustomPseudoContext<Node, ElementNode extends Node>(
    error: unknown,
    rule: InternalSelector,
    options: InternalOptions<Node, ElementNode>,
    groupIndex: number,
    tokenIndex: number,
): unknown {
    if (
        error instanceof Error &&
        !(error instanceof PseudoClassCompilationError) &&
        rule.type === SelectorType.Pseudo &&
        options.pseudos !== undefined &&
        rule.name in options.pseudos
    ) {
        return new PseudoClassCompilationError(
            rule.name,
            groupIndex,
            tokenIndex,
            error,
        );
    }

    return error;
}

const DESCENDANT_TOKEN: Selector = { type: SelectorType.Descendant };
const FLEXIBLE_DESCENDANT_TOKEN: InternalSelector = {
    type: "_flexibleDescendant",
};
const SCOPE_TOKEN: Selector = {
    type: SelectorType.Pseudo,
    name: "scope",
    data: null,
};

/*
 * CSS 4 Spec (Draft): 3.4.1. Absolutizing a Relative Selector
 * http://www.w3.org/TR/selectors4/#absolutizing
 */
function absolutize<Node, ElementNode extends Node>(
    token: InternalSelector[][],
    { adapter }: InternalOptions<Node, ElementNode>,
    context?: Node[],
) {
    // TODO Use better check if the context is a document
    const hasContext = !!context?.every(
        (element) =>
            element === PLACEHOLDER_ELEMENT ||
            (adapter.isTag(element) &&
                getElementParent(element, adapter) !== null),
    );

    for (const t of token) {
        if (
            t.length > 0 &&
            isTraversal(t[0]) &&
            t[0].type !== SelectorType.Descendant
        ) {
            // Don't continue in else branch
        } else if (hasContext && !t.some(includesScopePseudo)) {
            t.unshift(DESCENDANT_TOKEN);
        } else {
            continue;
        }

        t.unshift(SCOPE_TOKEN);
    }
}

/**
 * Compile a parsed selector token into an executable query function.
 * @param token Selector token(s) to compile.
 * @param options Options that control this operation.
 * @param compilationContext Compilation context for relative selector handling.
 */
export function compileToken<Node, ElementNode extends Node>(
    token: InternalSelector[][],
    options: InternalOptions<Node, ElementNode>,
    compilationContext?: Node[] | Node,
): CompiledQuery<ElementNode> {
    /*
     * Record the original position of each token before rules are sorted
     * or absolutized, so compile errors can point at the token as it was
     * written in the selector.
     */
    const tokenPositions = new Map<InternalSelector, number>();

    for (const rules of token) {
        for (const [index, rule] of rules.entries()) {
            tokenPositions.set(rule, index);
        }

        sortRules(rules);
    }

    const {
        context = compilationContext,
        rootFunc: rootFunction = boolbase.trueFunc,
    } = options;

    const isArrayContext = Array.isArray(context);

    const finalContext =
        context && (Array.isArray(context) ? context : [context]);

    // Check if the selector is relative
    if (options.relativeSelector !== false) {
        absolutize(token, options, finalContext);
    } else if (token.some((t) => t.length > 0 && isTraversal(t[0]))) {
        throw new Error(
            "Relative selectors are not allowed when the `relativeSelector` option is disabled",
        );
    }

    let shouldTestNextSiblings = false;
    let query: CompiledQuery<ElementNode> = boolbase.falseFunc;

    combineLoop: for (const [groupIndex, rules] of token.entries()) {
        if (rules.length >= 2) {
            const [first, second] = rules;

            if (first.type !== SelectorType.Pseudo || first.name !== "scope") {
                // Ignore
            } else if (
                isArrayContext &&
                second.type === SelectorType.Descendant
            ) {
                rules[1] = FLEXIBLE_DESCENDANT_TOKEN;
            } else if (
                second.type === SelectorType.Adjacent ||
                second.type === SelectorType.Sibling
            ) {
                shouldTestNextSiblings = true;
            }
        }

        let next = rootFunction;
        let hasExpensiveSubselector = false;

        for (const [tokenIndex, rule] of rules.entries()) {
            try {
                next = compileGeneralSelector(
                    next,
                    rule,
                    options,
                    finalContext,
                    compileToken,
                    hasExpensiveSubselector,
                );
            } catch (error) {
                /*
                 * Re-throw instead of returning the partially compiled
                 * `query`, so a failed compilation never leaves behind a
                 * half-finished function that could be reused.
                 */
                throw addCustomPseudoContext(
                    error,
                    rule,
                    options,
                    groupIndex,
                    tokenPositions.get(rule) ?? tokenIndex,
                );
            }

            const quality = getQuality(rule);

            if (quality === 0) {
                hasExpensiveSubselector = true;
            }

            // If the sub-selector won't match any elements, skip it.
            if (next === boolbase.falseFunc) {
                continue combineLoop;
            }
        }

        // If we have a function that always returns true, we can stop here.
        if (next === rootFunction) {
            return rootFunction;
        }

        query = query === boolbase.falseFunc ? next : or(query, next);
    }

    query.shouldTestNextSiblings = shouldTestNextSiblings;

    return query;
}

function or<T>(a: Predicate<T>, b: Predicate<T>): Predicate<T> {
    return (element) => a(element) || b(element);
}
