// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many shapes and connectors on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

type FrameData = {
  name: string;
  steps: QuestionStep[];
  expectedResult: ResultStep;
};

type QuestionStep = {
  id: string;
  questionText: string;
  selectedResponse: string;
};
type ResultStep = {
  id: "Product selector";
  result: string;
};

const testScenarioNameRegex = new RegExp(/(test\sscenario|\d)/, "i");
const COLUMN_HEADERS = [
  "Test Group",
  "Test Scenario ID",
  "Steps - Question ID: Question text: Selected Response",
  "Expected Result",
  "Status",
  "Actioned By",
  "Date",
  "Notes",
];

// Function to extract data a group of test scenarios
async function extractDataFromGroupFrame(frames: readonly SceneNode[]) {
  // Array to store data from all frames
  let testScenarios: SceneNode[] = [];

  // Iterate through selected frames
  for (const frame of frames) {
    testScenarios = (frame as SectionNode).children
      .filter((node) => node.type === "SECTION")
      .sort((a, b) => a.y - b.y);
    // ensures the sections are sorted top down
  }

  console.log("scenarios", testScenarios);

  return await extractDataFromTestFrames(testScenarios);
}

// Function to extract data from selected testframes
async function extractDataFromTestFrames(frames: readonly SceneNode[]) {
  // Array to store data from all frames
  const data: FrameData[] = [];

  // Set to store unique font combinations
  const fontsSet = new Set();

  // Iterate through selected frames
  for (const frame of frames) {
    // ensure we are dealing with section nodes
    if (frame.type === "SECTION" && frame.name.includes("test scenario")) {
      // Iterate through all text nodes in the frame (to load the fonts - otherwise everything breaks...)
      (frame as SectionNode)
        .findAll((node) => node.type === "TEXT")
        .forEach((textNode) => {
          const { fontName } = textNode;
          const fontString = `${fontName.family}-${fontName.style}`;
          fontsSet.add(fontString);
        });

      const steps: QuestionStep[] = [];
      let expectedResult: ResultStep = undefined;
      // grab children deets
      (frame as SectionNode)
        .findAll((node) => node.type === "SECTION")
        .sort((a, b) => a.x - b.x) // ensures the sections are ordered left to right for reading purposes
        .forEach((section) => {
          console.log("testing", section);
          if (section.name === "Product selector") {
            expectedResult = {
              id: section.name,
              result: (section as SectionNode).children
                .filter((child) => child.type === "TEXT")
                .map((textNode) => textNode.characters)
                .join(""),
            };
          } else {
            const textNodes = (section as SectionNode).children
              .filter(
                (child) =>
                  child.type === "TEXT" &&
                  !child.characters.toLowerCase().includes("response")
              )
              .sort((a, b) => a.y - b.y); // ensuring the text nodes are ordered top down for correct parsing

            steps.push({
              id: section.name,
              questionText: textNodes[0].characters,
              selectedResponse:
                textNodes
                  .slice(1)
                  .filter((response) => response.fontWeight === 700)[0]
                  ?.characters || "any text",
            });
          }
        });

      // Extract relevant data from the frame (just an example)
      const frameData = {
        name: frame.name,
        steps,
        expectedResult,
      };
      data.push(frameData);
    } else {
      return figma.notify(`Select a "test scenario" frame to export`);
    }
  }

  // Load each unique font asynchronously
  const loadFontPromises = Array.from(fontsSet).map((fontString) => {
    const [family, style] = fontString.split("-");
    return figma.loadFontAsync({ family, style });
  });

  // Wait for all font loading promises to resolve
  await Promise.all(loadFontPromises);

  return data;
}

// Function to convert data to CSV format
function convertToCSV(data: FrameData[], groupName: string = "") {
  let csvContent = "";

  // Add header row
  const headers = COLUMN_HEADERS.join(",");
  const emptyColumns = `"","","",""`;
  csvContent += headers + "\r\n";

  // Add data rows
  data.forEach(({ name, steps, expectedResult }, index) => {
    const stepsCombined = `"${steps
      .map((step) => Object.values(step).join(":"))
      .join("\r\n")}"`;

    csvContent += `${index === 0 ? groupName : ""},`;

    const resultString = `"${expectedResult.result}"`;

    const values = Object.values({ name, stepsCombined, resultString }).join(
      ","
    );
    csvContent += `${values},${emptyColumns},\r\n`;
  });

  return csvContent;
}

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg: { type: string; count: number }) => {
  // One way of distinguishing between different types of messages sent from
  // your HTML page is to use an object with a "type" property like this.
  if (msg.type === "export") {
    const selectedFrames = figma.currentPage.selection;
    if (selectedFrames.length === 0) {
      figma.notify("No frame selected.");
      return;
    } else if (selectedFrames.length > 1) {
      figma.notify("Please select a single frame (for now)");
      return;
    }
    const isTestGroupFrame = !testScenarioNameRegex.test(
      selectedFrames[0].name
    );
    let data;
    let filename = selectedFrames[0].name;
    // TODO: parse test group frames first
    if (isTestGroupFrame) {
      data = await extractDataFromGroupFrame(selectedFrames);
    } else {
      data = await extractDataFromTestFrames(selectedFrames);
    }

    // const data = await extractDataFromTestFrames(selectedFrames);
    if (!data) {
      return;
    }

    const csvContent = convertToCSV(data, isTestGroupFrame ? filename : "");
    // console.log(csvContent);
    figma.ui.postMessage({
      type: "csvData",
      content: csvContent,
      filename,
    });
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
  // figma.closePlugin();
};
