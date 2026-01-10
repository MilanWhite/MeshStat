import React from "react";

interface CenteredSpinnerProps {
    message?: string;
}

const CenteredSpinner: React.FC<CenteredSpinnerProps> = ({ message = "" }) => (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-transparent">
        <div
            className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-e-transparent text-gray-600 motion-reduce:animate-[spin_1.5s_linear_infinite]"
            role="status"
        />
        <p className="text-center text-gray-600">{message}</p>
    </div>
);

export default CenteredSpinner;
