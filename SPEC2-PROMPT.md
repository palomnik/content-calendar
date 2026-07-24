# Content Calendar Version 2 Upgrades

Use this prompt to rebuild the Content Calendar App, while preserving existing features. Do the following:

* Add a configuration screen that allows the user to select between the default sqlite database and an external mysql, mariadb or postgressql database.
* Put a selector at the top to choose different views.  The existing view is the default and should be called "Kanban View" There should also be a view of records by due date, called "Date". Another View is by Status called "Status". For the Date and Status views, The Date and Status labels should only be visible if they have records.  Display the Status and Date views with the "Dates" or "Status" Headers, and the records as single line lists below, linked to the records
* Plan and suggest (in a markdown document), but do not create a method for an LLM chat or button to assist with content brainstorming and other stages by status of content creating and publishing.
