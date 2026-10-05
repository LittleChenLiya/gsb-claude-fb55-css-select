import type { Selector } from "css-what";

/**
 * Selector token used internally by css-select.
 */
export type InternalSelector = Selector | { type: "_flexibleDescendant" };

/**
 * Predicate function for element matching.
 */
export type Predicate<Value> = (v: Value) => boolean;

/**
 * Adapter interface used to traverse and inspect DOM nodes.
 */
export interface Adapter<Node, ElementNode extends Node> {
    /**
     *  Is the node a tag?
     */
    isTag: (node: Node) => node is ElementNode;

    /**
     * Get the attribute value.
     */
    getAttributeValue: (
        element: ElementNode,
        name: string,
    ) => string | undefined;

    /**
     * Get the node's children
     */
    getChildren: (node: Node) => Node[];

    /**
     * Get the name of the tag
     */
    getName: (element: ElementNode) => string;

    /**
     * Get the parent of the node
     */
    getParent: (node: ElementNode) => Node | null;

    /**
     * Get the siblings of the node. Note that unlike jQuery's `siblings` method,
     * this is expected to include the current node as well
     */
    getSiblings: (node: Node) => Node[];

    /**
     * Returns the previous element sibling of a node.
     */
    prevElementSibling?: (node: Node) => ElementNode | null;

    /**
     * Get the text content of the node, and its children if it has any.
     */
    getText: (node: Node) => string;

    /**
     * Does the element have the named attribute?
     */
    hasAttrib: (element: ElementNode, name: string) => boolean;

    /**
     * Takes an array of nodes, and removes any duplicates, as well as any
     * nodes whose ancestors are also in the array.
     */
    removeSubsets: (nodes: Node[]) => Node[];

    /**
     * The adapter can also optionally include an equals method, if your DOM
     * structure needs a custom equality test to compare two objects which refer
     * to the same underlying node. If not provided, `css-select` will fall back to
     * `a === b`.
     */
    equals?: (a: Node, b: Node) => boolean;

    /**
     * Is the element in hovered state?
     */
    isHovered?: (element: ElementNode) => boolean;

    /**
     * Is the element in visited state?
     */
    isVisited?: (element: ElementNode) => boolean;

    /**
     * Is the element in active state?
     */
    isActive?: (element: ElementNode) => boolean;
}

/**
 * Argument type declared by a {@link PseudoExtension}.
 *
 * - `"string"`: the raw argument string is passed to the matcher.
 * - `"selector"`: the argument is parsed as a selector list (css-what) and the
 *   parsed tokens are passed to the matcher.
 */
export type PseudoExtensionArgumentType = "string" | "selector";

/**
 * A user-defined pseudo-class registered explicitly via `registerPseudo`.
 *
 * The declaration states whether an argument is required, its type, and
 * whether the extension is pure (its result only depends on the element and
 * the argument). Compilation checks the declaration and never calls the
 * matcher.
 */
export interface PseudoExtension<Node, ElementNode extends Node> {
    /** Name of the pseudo-class, without the leading colon. */
    name: string;

    /**
     * Whether an argument is required. When `true`, compiling a selector with
     * `:name` and no argument throws at compile time. Defaults to `false`.
     */
    required?: boolean;

    /**
     * Type of the argument.
     *
     * - `"string"` (the default): the raw argument string is passed to
     *   `match`.
     * - `"selector"`: the argument is parsed as a selector list by css-what at
     *   compile time; the parsed tokens are passed to `match`. Parse errors
     *   are reported at compile time.
     */
    argument?: PseudoExtensionArgumentType;

    /**
     * Whether the extension is pure: its result only depends on the element
     * and the argument and never changes. Pure extensions have their
     * per-element results cached. Defaults to `false`.
     */
    cacheable?: boolean;

    /**
     * Called when a compiled selector is executed against an element. Never
     * called during compilation.
     * @param element The element to match.
     * @param data The parsed argument, or `null` if no argument was given.
     * @param options The normalized options used for compilation.
     * @returns Whether the element matches.
     */
    match: (
        element: ElementNode,
        data: string | Selector[][] | null,
        options: InternalOptions<Node, ElementNode>,
    ) => boolean;
}

/**
 * Public query options for css-select.
 */
export interface Options<Node, ElementNode extends Node> {
    /**
     * When enabled, tag names will be case-sensitive.
     * @default false
     */
    xmlMode?: boolean;
    /**
     * Lower-case attribute names.
     * @default !xmlMode
     */
    lowerCaseAttributeNames?: boolean;
    /**
     * Lower-case tag names.
     * @default !xmlMode
     */
    lowerCaseTags?: boolean;
    /**
     * Is the document in quirks mode?
     *
     * This will lead to .className and #id being case-insensitive.
     * @default false
     */
    quirksMode?: boolean;
    /**
     * Pseudo-classes that override the default ones.
     *
     * Maps from names to either strings of functions.
     * - A string value is a selector that the element must match to be selected.
     * - A function is called with the element as its first argument, and optional
     *  parameters second. If it returns true, the element is selected.
     */
    pseudos?:
        | Record<
              string,
              | string
              | ((element: ElementNode, value?: string | null) => boolean)
          >
        | undefined;
    /**
     * The last function in the stack, will be called with the last element
     * that's looked at.
     */
    rootFunc?: (element: ElementNode) => boolean;
    /**
     * The adapter to use when interacting with the backing DOM structure. By
     * default it uses the `domutils` module.
     */
    adapter?: Adapter<Node, ElementNode> | undefined;
    /**
     * The context of the current query. Used to limit the scope of searches.
     * Can be matched directly using the `:scope` pseudo-class.
     */
    context?: Node | Node[];
    /**
     * Indicates whether to consider the selector as a relative selector.
     *
     * Relative selectors that don't include a `:scope` pseudo-class behave
     * as if they have a `:scope ` prefix (a `:scope` pseudo-class, followed by
     * a descendant selector).
     *
     * If relative selectors are disabled, selectors starting with a traversal
     * will lead to an error.
     * @default true
     * @see {@link https://www.w3.org/TR/selectors-4/#relative}
     */
    relativeSelector?: boolean;
    /**
     * Allow css-select to cache results for some selectors, sometimes greatly
     * improving querying performance. Disable this if your document can
     * change in between queries with the same compiled selector.
     * @default true
     */
    cacheResults?: boolean;
}

// Internally, we want to ensure that no propterties are accessed on the passed objects
/**
 * Normalized internal options with required adapter helpers.
 */
export interface InternalOptions<Node, ElementNode extends Node>
    extends Options<Node, ElementNode> {
    adapter: Adapter<Node, ElementNode>;
    equals: (a: Node, b: Node) => boolean;
}

/**
 * Executable selector query.
 */
export interface CompiledQuery<ElementNode> {
    (node: ElementNode): boolean;
    shouldTestNextSiblings?: boolean;
}

/**
 * Query input accepted by the public API.
 */
export type Query<ElementNode> =
    | string
    | CompiledQuery<ElementNode>
    | Selector[][];

/**
 * Function used to compile parsed selector tokens.
 */
export type CompileToken<Node, ElementNode extends Node> = (
    token: InternalSelector[][],
    options: InternalOptions<Node, ElementNode>,
    context?: Node[] | Node,
) => CompiledQuery<ElementNode>;
