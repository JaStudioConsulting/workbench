export { default as HeaderSearch, formatResultMetadata } from "./HeaderSearch.jsx";
export {
  NOTES_SEARCH_GROUP,
  PRIMARY_SEARCH_GROUPS,
  buildDisplayGroups,
  createSearchStateError,
  formatSearchResultItem,
  getCallerSearchAccessToken,
  isDisallowedSearchToken,
  mapGatewaySearchError,
  resolveSearchNavigation,
  runWorkbenchSearch,
  searchWorkbench,
} from "./searchClient.js";
