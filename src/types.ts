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
 * Whether a pseudo-class extension takes an argument.
 */
export type PseudoExtensionArgument = "none" | "optional" | "required";

/**
 * The type of argument a pseudo-class extension accepts.
 *
 * - `"string"`: The raw argument text is passed to the matcher.
 * - `"selector"`: The argument is parsed as a selector list by css-select's
 *   parser and the compiled matcher is passed to the extension.
 */
export type PseudoExtensionArgumentType = "string" | "selector";

/**
 * An explicitly registered pseudo-class extension.
 *
 * Extensions declare up-front whether their argument is required, which type
 * it has, and whether their results may be cached. Declarations are checked
 * at compile time — before any element is matched — and compilation never
 * accesses the DOM or runs the `match` function.
 */
export interface PseudoExtension<Node, ElementNode extends Node> {
    /**
     * Whether the pseudo-class takes an argument.
     * @default "none" (`"required"` when `argumentType` is `"selector"`)
     */
    argument?: PseudoExtensionArgument;
    /**
     * The type of the argument.
     * @default "string"
     */
    argumentType?: PseudoExtensionArgumentType;
    /**
     * Whether the extension is pure, meaning its result only depends on the
     * element and the argument. Only pure extensions have their results
     * cached.
     * @default false
     */
    pure?: boolean;
    /**
     * Must be set to `true` to replace a built-in pseudo-class or a legacy
     * `pseudos` entry with the same name.
     * @default false
     */
    override?: boolean;
    /**
     * The matcher. Only called while querying — never during compilation.
     * @param element The element to test.
     * @param argument The argument: a string for `argumentType: "string"`,
     * a compiled query for `argumentType: "selector"`, or `null`.
     * @param options The normalized options, including the DOM adapter.
     */
    match: (
        element: ElementNode,
        argument: string | CompiledQuery<ElementNode> | null,
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
     * Explicitly registered pseudo-class extensions.
     *
     * Each extension declares whether its argument is required, the argument
     * type, and whether it is pure (cacheable). Declarations are validated at
     * compile time — before any matching happens — and unknown or
     * unauthorized pseudo-classes are rejected. Compilation never touches the
     * DOM or runs the extension's `match` function.
     *
     * Replacing a built-in pseudo-class or a legacy `pseudos` entry with the
     * same name requires `override: true` on the extension.
     */
    pseudoExtensions?:
        | Record<string, PseudoExtension<Node, ElementNode>>
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
