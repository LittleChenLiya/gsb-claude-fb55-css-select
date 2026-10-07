import { SelectorType } from "css-what";
import { attributeRules } from "./attributes.js";
import { getElementParent } from "./helpers/querying.js";
import { compilePseudoSelector } from "./pseudo-selectors/index.js";
import type {
    CompiledQuery,
    CompileToken,
    InternalOptions,
    InternalSelector,
} from "./types.js";

/*
 * All available rules
 */

/**
 * Compile a single selector token.
 * @param next Matcher to run after this matcher succeeds.
 * @param selector Selector used to match elements.
 * @param options Options that control this operation.
 * @param context Context nodes used to scope selector matching.
 * @param compileToken Function used to compile nested selector tokens.
 * @param hasExpensiveSubselector Whether the selector contains expensive subselectors.
 */
export function compileGeneralSelector<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    selector: InternalSelector,
    options: InternalOptions<Node, ElementNode>,
    context: Node[] | undefined,
    compileToken: CompileToken<Node, ElementNode>,
    hasExpensiveSubselector: boolean,
): CompiledQuery<ElementNode> {
    const { adapter, equals, cacheResults } = options;

    /*
     * Ancestor matching must not cross the boundary of the query root(s).
     * When a context is set (and relative selectors are enabled), ancestor
     * combinators stop once they reach a context root that isn't nested
     * below another context root; the root itself is still tested, so
     * `:scope` keeps working. With `relativeSelector` disabled, selectors
     * are matched against the whole tree as before.
     */
    const isRootBoundary =
        context && context.length > 0 && options.relativeSelector !== false
            ? (node: ElementNode): boolean => {
                  let isRoot = false;

                  for (const root of context) {
                      if (equals(root, node)) {
                          isRoot = true;
                          continue;
                      }

                      /*
                       * Roots that are nested below another root are not a
                       * boundary; the outermost root is.
                       */
                      let current = getElementParent(node, adapter);

                      while (current) {
                          if (equals(current, root)) {
                              return false;
                          }

                          current = getElementParent(current, adapter);
                      }
                  }

                  return isRoot;
              }
            : undefined;

    switch (selector.type) {
        case SelectorType.PseudoElement: {
            throw new Error("Pseudo-elements are not supported by css-select");
        }
        case SelectorType.ColumnCombinator: {
            throw new Error(
                "Column combinators are not yet supported by css-select",
            );
        }
        case SelectorType.Attribute: {
            if (selector.namespace != null) {
                throw new Error(
                    "Namespaced attributes are not yet supported by css-select",
                );
            }

            if (!options.xmlMode || options.lowerCaseAttributeNames) {
                selector.name = selector.name.toLowerCase();
            }
            return attributeRules[selector.action](next, selector, options);
        }
        case SelectorType.Pseudo: {
            return compilePseudoSelector(
                next,
                selector,
                options,
                context,
                compileToken,
            );
        }
        // Tags
        case SelectorType.Tag: {
            if (selector.namespace != null) {
                throw new Error(
                    "Namespaced tag names are not yet supported by css-select",
                );
            }

            let { name } = selector;

            if (!options.xmlMode || options.lowerCaseTags) {
                name = name.toLowerCase();
            }

            return function tag(element: ElementNode): boolean {
                return adapter.getName(element) === name && next(element);
            };
        }

        // Traversal
        case SelectorType.Descendant: {
            if (
                !hasExpensiveSubselector ||
                cacheResults === false ||
                typeof WeakMap === "undefined"
            ) {
                return function descendant(element: ElementNode): boolean {
                    let current: ElementNode | null = element;

                    while ((current = getElementParent(current, adapter))) {
                        if (next(current)) {
                            return true;
                        }

                        // Don't cross the boundary of the query root.
                        if (isRootBoundary?.(current)) {
                            return false;
                        }
                    }

                    return false;
                };
            }

            const resultCache = new WeakMap<
                // @ts-expect-error `ElementNode` is not extending object
                ElementNode,
                { matches: boolean }
            >();
            return function cachedDescendant(element: ElementNode): boolean {
                let current: ElementNode | null = element;
                let result: { matches: boolean } | undefined;

                while ((current = getElementParent(current, adapter))) {
                    const cached = resultCache.get(current);

                    if (cached === undefined) {
                        result ??= { matches: false };
                        result.matches = next(current);
                        resultCache.set(current, result);
                        if (result.matches) {
                            return true;
                        }
                    } else {
                        if (result) {
                            result.matches = cached.matches;
                        }
                        return cached.matches;
                    }

                    // Don't cross the boundary of the query root.
                    if (isRootBoundary?.(current)) {
                        return false;
                    }
                }

                return false;
            };
        }
        case "_flexibleDescendant": {
            // Include element itself, only used while querying an array
            return function flexibleDescendant(element: ElementNode): boolean {
                let current: ElementNode | null = element;

                do {
                    if (next(current)) {
                        return true;
                    }

                    // Don't cross the boundary of the query root.
                    if (isRootBoundary?.(current)) {
                        return false;
                    }

                    current = getElementParent(current, adapter);
                } while (current);

                return false;
            };
        }
        case SelectorType.Parent: {
            return function parent(element: ElementNode): boolean {
                return adapter
                    .getChildren(element)
                    .some((element) => adapter.isTag(element) && next(element));
            };
        }
        case SelectorType.Child: {
            return function child(element: ElementNode): boolean {
                // The parent of a query root is outside of the root boundary.
                if (isRootBoundary?.(element)) {
                    return false;
                }

                const parent = getElementParent(element, adapter);
                return parent !== null && next(parent);
            };
        }
        case SelectorType.Sibling: {
            return function sibling(element: ElementNode): boolean {
                const siblings = adapter.getSiblings(element);

                for (const currentSibling of siblings) {
                    if (equals(element, currentSibling)) {
                        break;
                    }
                    if (adapter.isTag(currentSibling) && next(currentSibling)) {
                        return true;
                    }
                }

                return false;
            };
        }
        case SelectorType.Adjacent: {
            if (adapter.prevElementSibling) {
                return function adjacent(element: ElementNode): boolean {
                    // biome-ignore lint/style/noNonNullAssertion: checked by if statement
                    const previous = adapter.prevElementSibling!(element);
                    return previous != null && next(previous);
                };
            }

            return function adjacent(element: ElementNode): boolean {
                const siblings = adapter.getSiblings(element);
                let lastElement: ElementNode | undefined;

                for (const currentSibling of siblings) {
                    if (equals(element, currentSibling)) {
                        break;
                    }
                    if (adapter.isTag(currentSibling)) {
                        lastElement = currentSibling;
                    }
                }

                return !!lastElement && next(lastElement);
            };
        }
        case SelectorType.Universal: {
            if (selector.namespace != null && selector.namespace !== "*") {
                throw new Error(
                    "Namespaced universal selectors are not yet supported by css-select",
                );
            }

            return next;
        }
    }
}
