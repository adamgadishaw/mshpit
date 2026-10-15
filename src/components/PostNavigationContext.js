import { createContext } from "react";

// Opens a post by its id from anywhere a card is shown (an opener's review
// linked from the main review). The app shell loads the post and opens it;
// null where no shell is present.
export const PostNavigationContext = createContext(null);
