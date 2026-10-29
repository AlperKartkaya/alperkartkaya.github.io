#include <emscripten/bind.h>
#include "FGFDMExec.h"

using JSBSim::FGFDMExec;
using namespace emscripten;

EMSCRIPTEN_BINDINGS(flightbench) {
  class_<FGFDMExec>("FGFDMExec")
    .constructor<>()
    .function("Run", &FGFDMExec::Run)
    .function("RunIC", &FGFDMExec::RunIC)
    .function("LoadModel", select_overload<bool(const std::string&, bool)>(&FGFDMExec::LoadModel))
    .function("SetRootDir", optional_override([](FGFDMExec& f, std::string p) { f.SetRootDir(SGPath(p)); }))
    .function("SetAircraftPath", optional_override([](FGFDMExec& f, std::string p) { return f.SetAircraftPath(SGPath(p)); }))
    .function("SetEnginePath", optional_override([](FGFDMExec& f, std::string p) { return f.SetEnginePath(SGPath(p)); }))
    .function("SetSystemsPath", optional_override([](FGFDMExec& f, std::string p) { return f.SetSystemsPath(SGPath(p)); }))
    .function("Setdt", &FGFDMExec::Setdt)
    .function("SetDebugLevel", &FGFDMExec::SetDebugLevel)
    .function("DisableOutput", &FGFDMExec::DisableOutput)
    .function("GetPropertyValue", &FGFDMExec::GetPropertyValue)
    .function("SetPropertyValue", &FGFDMExec::SetPropertyValue);
}
