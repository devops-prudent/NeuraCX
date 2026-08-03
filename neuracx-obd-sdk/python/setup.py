from setuptools import find_packages, setup

setup(
    name="omni-obd-sdk",
    version="1.0.0",
    description="Official Python SDK for the Omni Outbound Dial (OBD) API",
    packages=find_packages(exclude=["examples", "tests"]),
    install_requires=["requests>=2.25.0"],
    python_requires=">=3.7",
    license="MIT",
)
