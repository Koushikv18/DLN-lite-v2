const fabricService = require("./services/fabricService");

async function run() {
  try {
    console.log("Connecting to Fabric and getting all shipments...");
    const shipments = await fabricService.getAllShipments();
    console.log(shipments);
    console.log("Done.");
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
