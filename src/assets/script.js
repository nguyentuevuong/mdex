// Event listener for click events
document.addEventListener("click", (evt) => {
  const { target } = evt;

  // Check if the clicked element has the "chevron" class
  if (target.classList.contains("chevron")) {
    console.log({ target });

    // Get the closest <li> element to the clicked element
    const closest = target.closest("li");

    // Check if the list item is expanded
    if (closest) {
      const expanded = closest.classList.contains("expanded");

      // If the list item is not expanded, add the "expanded" class
      if (!expanded) {
        closest.classList.add("expanded");
      } else {
        // If the list item is expanded, remove the "expanded" class
        closest.classList.remove("expanded");
      }
    }
  }
});
